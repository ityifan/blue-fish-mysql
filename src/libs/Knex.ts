import { _ } from 'coa-helper';
import * as Knex from 'knex';
import { CoaMysql } from '../typings';

declare module 'knex' {
  interface QueryBuilder {
    search(columns: string[], value: string): Knex.QueryBuilder
    filter(data: CoaMysql.Dic<string | number>, table?: string): Knex.QueryBuilder
    period(column: string, from: number, to: number): Knex.QueryBuilder
    inArray(array_column: string, value: string | number): Knex.QueryBuilder
  }
}

// 扩展 Knex 的 QueryBuilder 以提供搜索、过滤等功能
Knex.QueryBuilder.extend('search', function (columns: string[], value: string) {
  const length = columns.length;
  value &&
    length &&
    this.where(qb => {
      const search = '%' + value + '%';
      if (length >= 1) qb.where(columns[0], 'like', search);
      if (length >= 2) for (let i = 1; i < length; i++) qb.orWhere(columns[i], 'like', search);
    });
  return this;
});

Knex.QueryBuilder.extend('filter', function (data: CoaMysql.Dic<string | number>, table?: string) {
  data = _.pickBy(data);
  if (table) data = _.mapKeys(data, (v, k) => table + '.' + k);
  return this.where(data);
});

Knex.QueryBuilder.extend('period', function (column: string, from: number, to: number) {
  column && from > 0 && this.where(column, '>=', from);
  column && to > 0 && this.where(column, '<=', to);
  return this;
});

Knex.QueryBuilder.extend('inArray', function (array_column: string, value: string | number) {
  array_column && value && this.whereRaw('JSON_CONTAINS( ??, JSON_ARRAY( ? ) )', [array_column, value]);
  return this;
});

export { Knex };
