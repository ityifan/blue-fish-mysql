import { Knex } from "knex"
export type Dic<T = any> = Record<string, T>

export namespace CoaMysql {
  export interface Dic<T> {
    [key: string]: T
  }


  // 扩展后的 QueryBuilder 类型（注意这里继承了 Knex 自带的）
  export interface ExtendedQueryBuilder<TRecord extends Record<string, any> = any, TResult = any>
    extends Knex.QueryBuilder<TRecord, TResult> {
    filter(data: Dic<string | number>, table?: string): ExtendedQueryBuilder<TRecord, TResult>
    search(columns: string[], value: string): ExtendedQueryBuilder<TRecord, TResult>
    period(column: string, from: number, to: number): ExtendedQueryBuilder<TRecord, TResult>
    inArray(array_column: string, value: string | number): ExtendedQueryBuilder<TRecord, TResult>
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  export type SafePartial<T> = T extends {} ? Partial<T> : any
  export type Query<TRecord extends Record<string, any> = Record<string, any>, TResult = any> = (qb: ExtendedQueryBuilder<TRecord, TResult>) => void
  export type QueryBuilder = Knex.QueryBuilder
  export interface Transaction extends Knex.Transaction {
    __isSafeTransaction?: boolean
    clearCacheNsps?: any[]
  }
  export interface Pager {
    rows: number
    last: number
    page: number
    ext?: any
  }

  export interface ModelOption<T> {
    name: string
    scheme: T
    title?: string
    key?: string
    prefix?: string
    system?: string
    increment?: string
    pick: string[]
    unpick?: string[]
    caches?: { index?: string[]; count?: string[] }
  }

  export interface Config {
    host: string
    port: number
    user: string
    password: string
    charset: string
    databases: {
      [name: string]: { database: string; ms: number }
    }
    debug: boolean
    trace: boolean
    pool?: { min: number; max: number }
  }
}
