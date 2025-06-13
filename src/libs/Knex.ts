
import { _ } from 'coa-helper'
import type { Knex as KnexType } from 'knex'
import Knex, { knex } from 'knex'
import type { CoaMysql } from '../typings'

type QB<TRecord extends Record<string, unknown> = any, TResult = any> =
    KnexType.QueryBuilder<string, string>

// ------- 类型扩展 -------
declare module 'knex' {
    interface QueryBuilder<TRecord extends Record<string, unknown> = any, TResult = any> {
        search(columns: string[], value: string): QB<TRecord, TResult>
        filter(data: CoaMysql.Dic<string | number>, table?: string): QB<TRecord, TResult>
        period(column: string, from: number, to: number): QB<TRecord, TResult>
        inArray(array_column: string, value: string | number): QB<TRecord, TResult>
    }
}

// ------- 方法扩展 -------

// 搜索语法糖，可以搜索多个列
knex.QueryBuilder.extend('search', function (columns: string[], value: string) {
    const length = columns.length
    if (value && length) {
        const search = `%${value}%`
        this.where(qb => {
            qb.where(columns[0], 'like', search)
            for (let i = 1; i < length; i++) {
                qb.orWhere(columns[i], 'like', search)
            }
        })
    }
    return this
})

// 筛选语法糖，可以筛选出对应数据，如果传 falsy 值（如 null, undefined, 空字符串）则忽略
knex.QueryBuilder.extend('filter', function (data: CoaMysql.Dic<string | number>, table?: string) {
    data = _.pickBy(data) // 过滤 falsy 值
    if (table) data = _.mapKeys(data, (v, k) => `${table}.${k}`)
    return this.where(data)
})

// 时段筛选语法糖，根据列名和开始结束时间筛选
knex.QueryBuilder.extend('period', function (column: string, from: number, to: number) {
    if (column && from > 0) this.where(column, '>=', from)
    if (column && to > 0) this.where(column, '<=', to)
    return this
})

// 判断字段是否是 JSON 数组，且包含 value
knex.QueryBuilder.extend('inArray', function (array_column: string, value: string | number) {
    if (array_column && value != null) {
        this.whereRaw('JSON_CONTAINS( ??, JSON_ARRAY(?) )', [array_column, value])
    }
    return this
})

export { Knex }
