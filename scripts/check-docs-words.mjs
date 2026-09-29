#!/usr/bin/env node
// Keeps upgrade history out of the repository: nothing is released yet, so docs describe what
// is, not what changed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lineOf, report } from './lib/scan.mjs';

/** Wording that describes a change rather than the current state, in docs and READMEs. */
const PHRASES = [
  /\bformerly\b/gi,
  /\bused to be\b/gi,
  /\bolder (projects?|instances?|releases?)\b/gi,
  /\bwhere they are missing\b/gi,
  /\btook over from\b/gi,
  /\bbecame a plugin\b/gi,
  /\bbefore (Manablox )?0\.\d+/gi,
  /\b(made|created) (before|with) (Manablox )?0\.\d+/gi,
  /\brenamed (from|to)\b/gi,
  /\bstill (accepted|read) as\b/gi,
  /\bas before\b/gi,
  /\bearlier versions? (of Manablox|had)\b/gi,
  /\bbefore you upgrade\b/gi,
  /\bupgrade guide\b/gi,
  /\bafter an upgrade\b/gi,
];

const PROSE = (path) => path.endsWith('.md') && !path.includes('/src/');

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((path) => path && PROSE(path));

const findings = [];
for (const path of files) {
  const text = readFileSync(path, 'utf8');
  for (const phrase of PHRASES) {
    for (const match of text.matchAll(phrase)) {
      findings.push({
        where: `${path}:${lineOf(text, match.index)}`,
        found: match[0],
        message: 'describe what is, not what changed',
      });
    }
  }
}

report('docs:words', findings, `${files.length} files`);
