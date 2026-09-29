// Public API: discovery at setup, then one visitor per surface (REST `/v1`, `/graphql`).

import { group, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { config, isBreakpoint } from './config.js';
import { expectJson, expectStatus, pick, thinkTime, withQuery } from './http.js';

const api = config.publicApi;
const base = api.url;
const locale = config.locale || undefined;

const restDuration = new Trend('api_rest_duration', true);
const graphqlDuration = new Trend('api_graphql_duration', true);

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

function tagged(surface, name) {
  return { headers: JSON_HEADERS, tags: { surface, name } };
}

// Setup probes accept any status and stay out of the thresholds.
function probe(name) {
  return {
    headers: JSON_HEADERS,
    tags: { surface: 'setup', name },
    responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
  };
}

/** Discovers the space's content once at setup, falling back to `targets.json`. */
export function discover() {
  const found = {
    ids: [],
    permalinks: [],
    types: [],
    menus: api.menus || [],
    search: api.search || ['a'],
    home: false,
  };

  const service = http.get(`${base}/`, probe('service'));
  if (service.status !== 200) {
    throw new Error(
      `public API at ${base} answered ${service.status} to GET /; is it running and pinned to a space?`,
    );
  }

  const types = http.get(`${base}/v1/types`, probe('types'));
  if (types.status === 200) {
    const body = types.json();
    found.types = (body.types || [])
      .filter((type) => type.kind === 'content')
      .map((type) => type.name);
  }
  if (found.types.length === 0) found.types = api.contentTypes || [];

  // Two pages is enough variety.
  for (const offset of [0, 100]) {
    const list = http.get(
      `${base}${withQuery('/v1/content', { limit: 100, offset, locale })}`,
      probe('list'),
    );
    if (list.status !== 200) break;
    const body = list.json();
    for (const item of body.items || []) {
      found.ids.push(item.id);
      if (item.permalink) found.permalinks.push(item.permalink.replace(/^\/+/, ''));
    }
    if ((body.items || []).length < 100) break;
  }
  if (found.permalinks.length === 0) {
    found.permalinks = (api.permalinks || []).filter((p) => p !== '');
  }

  const home = http.get(`${base}${withQuery('/v1/permalink', { locale })}`, probe('home'));
  found.home = home.status === 200;

  const menus = [];
  for (const name of found.menus) {
    const res = http.get(`${base}${withQuery(`/v1/menus/${name}`, { locale })}`, probe('menu'));
    if (res.status === 200) menus.push(name);
  }
  found.menus = menus;

  console.log(
    `discovered ${found.ids.length} documents, ${found.permalinks.length} permalinks, ` +
      `${found.types.length} content types, ${found.menus.length} menus, home ${found.home ? 'yes' : 'no'}`,
  );
  return found;
}

// ---- REST visitor ------------------------------------------------------------------

export function restVisitor(data) {
  if (isBreakpoint) return restProbe(data);
  group('rest', () => {
    // Page view: menu, page, then a list or detail.
    if (data.menus.length) {
      const res = http.get(
        `${base}${withQuery(`/v1/menus/${pick(data.menus)}`, { locale })}`,
        tagged('rest', 'menu'),
      );
      restDuration.add(res.timings.duration, { name: 'menu' });
      expectJson(res, 'rest menu', (body) => Array.isArray(body.items));
    }

    if (data.home && Math.random() < 0.3) {
      const res = http.get(
        `${base}${withQuery('/v1/permalink', { locale })}`,
        tagged('rest', 'home'),
      );
      restDuration.add(res.timings.duration, { name: 'home' });
      expectJson(res, 'rest home', (body) => typeof body.id === 'string');
    } else if (data.permalinks.length) {
      const path = pick(data.permalinks);
      const res = http.get(
        `${base}${withQuery(`/v1/permalink/${path}`, { locale })}`,
        tagged('rest', 'permalink'),
      );
      restDuration.add(res.timings.duration, { name: 'permalink' });
      expectJson(res, 'rest permalink', (body) => typeof body.id === 'string');
    }

    sleep(thinkTime());

    const roll = Math.random();
    if (roll < 0.45) {
      const type = data.types.length ? pick(data.types) : undefined;
      const res = http.get(
        `${base}${withQuery('/v1/content', { type, limit: 25, offset: pick([0, 25, 50]), locale })}`,
        tagged('rest', 'list'),
      );
      restDuration.add(res.timings.duration, { name: 'list' });
      expectJson(res, 'rest list', (body) => Array.isArray(body.items));
    } else if (roll < 0.8 && data.ids.length) {
      const res = http.get(`${base}/v1/content/${pick(data.ids)}`, tagged('rest', 'get'));
      restDuration.add(res.timings.duration, { name: 'get' });
      expectJson(res, 'rest get', (body) => typeof body.id === 'string');
    } else if (roll < 0.9) {
      const res = http.get(
        `${base}${withQuery('/v1/content', { search: pick(data.search), limit: 10, locale })}`,
        tagged('rest', 'search'),
      );
      restDuration.add(res.timings.duration, { name: 'search' });
      expectJson(res, 'rest search', (body) => Array.isArray(body.items));
    } else {
      // Uncached miss; should still be fast.
      const res = http.get(`${base}/v1/content/00000000-0000-4000-8000-000000000000`, {
        ...tagged('rest', 'miss'),
        responseCallback: http.expectedStatuses(404, 429),
      });
      restDuration.add(res.timings.duration, { name: 'miss' });
      expectStatus(res, 'rest miss', 404);
    }
  });

  sleep(thinkTime());
}

// ---- GraphQL visitor ---------------------------------------------------------------

const listFields = api.graphql?.listFields || 'id title slug permalink';
const pageFields = api.graphql?.pageFields || 'id title slug permalink';

function gql(name, query, variables) {
  const res = http.post(
    `${base}/graphql`,
    JSON.stringify({ query, variables }),
    tagged('graphql', name),
  );
  graphqlDuration.add(res.timings.duration, { name });
  expectJson(res, `graphql ${name}`, (body) => body.data !== undefined && !body.errors);
  return res;
}

export function graphqlVisitor(data) {
  if (isBreakpoint) return graphqlProbe(data);
  group('graphql', () => {
    // Menu and document in one round trip, like an SSR frontend.
    const wantsMenu = data.menus.length > 0;
    const menuPart = wantsMenu
      ? 'menu(name: $menu, locale: $locale) { id items { id label url } }'
      : '';
    const permalink =
      data.home && Math.random() < 0.3 ? '' : data.permalinks.length ? pick(data.permalinks) : '';

    gql(
      'page',
      `query Page($permalink: String!, $locale: String${wantsMenu ? ', $menu: String!' : ''}) {
        contentByPermalink(permalink: $permalink, locale: $locale) { ${pageFields} }
        ${menuPart}
      }`,
      { permalink, locale: locale || null, ...(wantsMenu ? { menu: pick(data.menus) } : {}) },
    );

    sleep(thinkTime());

    const roll = Math.random();
    if (roll < 0.5) {
      gql(
        'list',
        `query List($type: String, $limit: Int, $offset: Int, $locale: String) {
          contentsPage(type: $type, limit: $limit, offset: $offset, locale: $locale) { items { ${listFields} } }
        }`,
        {
          type: data.types.length ? pick(data.types) : null,
          limit: 25,
          offset: pick([0, 25, 50]),
          locale: locale || null,
        },
      );
    } else if (data.ids.length) {
      gql('get', `query Get($id: String!) { content(id: $id) { ${pageFields} } }`, {
        id: pick(data.ids),
      });
    } else {
      gql(
        'search',
        `query Search($search: String, $locale: String) { contentsPage(search: $search, limit: 10, locale: $locale) { items { ${listFields} } } }`,
        { search: pick(data.search), locale: locale || null },
      );
    }
  });

  sleep(thinkTime());
}

// Capacity probes: one request per iteration, mirroring the visitors' mix.

function restProbe(data) {
  const roll = Math.random();
  if (roll < 0.25 && data.menus.length) {
    const res = http.get(
      `${base}${withQuery(`/v1/menus/${pick(data.menus)}`, { locale })}`,
      tagged('rest', 'menu'),
    );
    restDuration.add(res.timings.duration, { name: 'menu' });
    expectJson(res, 'rest menu', (body) => Array.isArray(body.items));
  } else if (roll < 0.5 && data.permalinks.length) {
    const res = http.get(
      `${base}${withQuery(`/v1/permalink/${pick(data.permalinks)}`, { locale })}`,
      tagged('rest', 'permalink'),
    );
    restDuration.add(res.timings.duration, { name: 'permalink' });
    expectJson(res, 'rest permalink', (body) => typeof body.id === 'string');
  } else if (roll < 0.75) {
    const type = data.types.length ? pick(data.types) : undefined;
    const res = http.get(
      `${base}${withQuery('/v1/content', { type, limit: 25, offset: pick([0, 25, 50]), locale })}`,
      tagged('rest', 'list'),
    );
    restDuration.add(res.timings.duration, { name: 'list' });
    expectJson(res, 'rest list', (body) => Array.isArray(body.items));
  } else if (data.ids.length) {
    const res = http.get(`${base}/v1/content/${pick(data.ids)}`, tagged('rest', 'get'));
    restDuration.add(res.timings.duration, { name: 'get' });
    expectJson(res, 'rest get', (body) => typeof body.id === 'string');
  } else {
    const res = http.get(
      `${base}${withQuery('/v1/permalink', { locale })}`,
      tagged('rest', 'home'),
    );
    restDuration.add(res.timings.duration, { name: 'home' });
    expectJson(res, 'rest home', (body) => typeof body.id === 'string');
  }
}

function graphqlProbe(data) {
  const roll = Math.random();
  if (roll < 0.5) {
    const permalink = data.permalinks.length && Math.random() < 0.7 ? pick(data.permalinks) : '';
    gql(
      'page',
      `query Page($permalink: String!, $locale: String) {
        contentByPermalink(permalink: $permalink, locale: $locale) { ${pageFields} }
      }`,
      { permalink, locale: locale || null },
    );
  } else if (roll < 0.8) {
    gql(
      'list',
      `query List($type: String, $limit: Int, $offset: Int, $locale: String) {
        contentsPage(type: $type, limit: $limit, offset: $offset, locale: $locale) { items { ${listFields} } }
      }`,
      {
        type: data.types.length ? pick(data.types) : null,
        limit: 25,
        offset: pick([0, 25, 50]),
        locale: locale || null,
      },
    );
  } else if (data.ids.length) {
    gql('get', `query Get($id: String!) { content(id: $id) { ${pageFields} } }`, {
      id: pick(data.ids),
    });
  } else {
    gql(
      'search',
      `query Search($search: String, $locale: String) { contentsPage(search: $search, limit: 10, locale: $locale) { items { ${listFields} } } }`,
      { search: pick(data.search), locale: locale || null },
    );
  }
}

export function apiThresholds() {
  return {
    // Makes k6 list these sub-metrics in the summary.
    'http_reqs{surface:rest}': ['count>=0'],
    'http_reqs{surface:graphql}': ['count>=0'],
    'http_req_duration{surface:rest}': [`p(95)<${api.p95}`, `p(99)<${api.p99}`],
    'http_req_duration{surface:graphql}': [`p(95)<${api.p95}`, `p(99)<${api.p99}`],
    'http_req_failed{surface:rest}': [`rate<${config.maxErrorRate}`],
    'http_req_failed{surface:graphql}': [`rate<${config.maxErrorRate}`],
    check_failures: [`rate<${config.maxErrorRate}`],
  };
}
