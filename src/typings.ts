import { Knex } from "knex"

export namespace CoaMysql {
  export interface Dic<T> {
    [key: string]: T
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  export type SafePartial<T> = T extends {} ? Partial<T> : any
  export type Query = (qb: Knex.QueryBuilder) => void
  export type QueryBuilder = Knex.QueryBuilder
  export type Transaction = any
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
