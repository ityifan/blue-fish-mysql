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

  /** 当前模型覆盖全局 Redis cache lock 的配置；不配置则使用 RedisBin 全局配置 */
  export interface CacheLockConfig {
    /** 是否启用 Redis 锁请求合并；默认启用，设置为 false 后 miss 会直接执行 worker */
    enabled?: boolean
    /** 锁的过期时间，单位毫秒；启用 renew 时会自动续期，默认 3000 */
    lockMs?: number
    /** 未抢到锁时等待缓存回填的最长时间，单位毫秒；默认 lockMs * 10 */
    waitMs?: number
    /** 未抢到锁时两次重读缓存之间的基础等待时间，单位毫秒，默认 50 */
    intervalMs?: number
    /** 等待间隔的随机抖动范围，单位毫秒；实际等待为 intervalMs + random(0, jitterMs)，默认 50 */
    jitterMs?: number
    /** 持有锁执行 worker 期间是否自动续期，避免慢 SQL 超过 lockMs 后锁提前失效；默认启用 */
    renew?: boolean
    /** 锁续期间隔，单位毫秒；默认 lockMs / 3，且不低于 100 */
    renewIntervalMs?: number
    /** 看门狗最大续期时间，单位毫秒；超过后停止续期，0 表示不限制，默认 0 */
    maxRenewMs?: number
    /** 等待缓存回填超时后的策略；throw 表示抛错保护 MySQL，query 表示降级执行 worker，默认 throw */
    timeoutStrategy?: 'throw' | 'query'
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
    /** 当前模型覆盖全局 Redis cache lock 的配置；不配置则使用 RedisBin 全局配置 */
    cacheLock?: CacheLockConfig
  }

  export interface Config {
    host: string
    port: number
    user: string
    password: string
    charset: string
    mGetByIdsChunk: number
    databases: {
      [name: string]: { database: string; ms: number }
    }
    debug: boolean
    trace: boolean
    pool?: { min: number; max: number }
  }
}
