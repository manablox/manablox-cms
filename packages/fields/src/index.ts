import { type AnyFieldType, definePlugin } from '@manablox/core';
import { blockField, blocksField } from './blocks.js';
import { booleanField } from './boolean.js';
import { databagField } from './databag.js';
import { dateField } from './date.js';
import { linkField } from './link.js';
import { numberField } from './number.js';
import { assetField, contentField, userField } from './relations.js';
import { repeaterField } from './repeater.js';
import { richTextField } from './richtext.js';
import { selectField } from './select.js';
import { stringField } from './string.js';
import { templateField } from './template.js';

export * from './blocks.js';
export * from './boolean.js';
export * from './databag.js';
export * from './date.js';
export * from './image-sizes.js';
export * from './link.js';
export * from './number.js';
export * from './relations.js';
export * from './repeater.js';
export * from './richtext.js';
export * from './richtext-html.js';
export * from './select.js';
export * from './settings-schema.js';
export * from './string.js';
export * from './template.js';

/** Built-in field types, in "add field" menu order. */
export const builtinFieldTypes: AnyFieldType[] = [
  stringField,
  richTextField,
  numberField,
  booleanField,
  dateField,
  selectField,
  linkField,
  assetField,
  contentField,
  userField,
  blockField,
  blocksField,
  repeaterField,
  templateField,
  databagField,
];

/** Registers the built-in field types. */
export const manabloxFields = () =>
  definePlugin({
    name: '@manablox/fields',
    fieldTypes: builtinFieldTypes,
  });
