import { _ } from 'blue-fish-helper'
import { CoaRedis, RedisCache } from 'blue-fish-redis'
import { CoaError } from 'coa-error'
import { secure } from 'coa-secure'
import { MysqlBin } from '../libs/MysqlBin'
import { CoaMysql } from '../typings'
import { MysqlNative } from './MysqlNative'
export class MysqlCache<Scheme> extends MysqlNative<Scheme> {
  redisCache: RedisCache

  constructor(option: CoaMysql.ModelOption<Scheme>, bin: MysqlBin, redisCache: RedisCache) {
    super(option, bin)
    this.redisCache = redisCache
  }

  async insert(data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const id = await super.insert(data, trx);
    await this.deleteCache([id], [data], trx)
    return id
  }

  async mInsert(dataList: Array<CoaMysql.SafePartial<Scheme>>, trx?: CoaMysql.Transaction) {
    const ids = await super.mInsert(dataList, trx);
    await this.deleteCache(ids, dataList, trx)
    return ids
  }

  async updateById(id: string, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx)
    const result = await super.updateById(id, data, trx)
    if (result) await this.deleteCache([id], dataList, trx)
    return result
  }

  async updateByIds(ids: string[], data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList(ids, data, trx)
    const result = await super.updateByIds(ids, data, trx);
    if (result) await this.deleteCache(ids, dataList, trx)
    return result
  }

  async updateForQueryById(id: string, query: CoaMysql.Query, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx)
    const result = await super.updateForQueryById(id, query, data, trx);
    if (result) await this.deleteCache([id], dataList, trx)
    return result
  }

  async upsertById(id: string, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx)
    const result = await super.upsertById(id, data, trx);
    await this.deleteCache([id], dataList, trx)
    return result
  }

  async deleteByIds(ids: string[], trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList(ids, undefined, trx)
    const result = await super.deleteByIds(ids, trx);
    await this.deleteCache(ids, dataList, trx)
    return result
  }

  async checkById(id: string, pick = this.columns, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    return (await this.getById(id, pick, trx, ms, force)) ?? CoaError.throw('MysqlCache.DataNotFound', `${this.title}不存在`)
  }

  async getById(id: string, pick = this.columns, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    const result = trx?.__isSafeTransaction ? await super.getById(id, this.columns, trx) : await this.cacheWarp(this.getCacheNsp('id'), id, async () => await super.getById(id, this.columns, trx), ms, force)
    return this.pickResult(result, pick)
  }

  async getIdBy(field: string, value: string | number, trx?: CoaMysql.Transaction) {
    return trx?.__isSafeTransaction ? await super.getIdBy(field, value, trx) : await this.cacheWarp(this.getCacheNsp('index', field), '' + value, async () => await super.getIdBy(field, value, trx))
  }

  async mGetByIds(ids: string[], pick = this.pick, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    const uniqueIds = _.uniq(ids)
    const count = uniqueIds.length
    const mGetByIdsChunk = _.toInteger(this.bin.config.mGetByIdsChunk || 0)
    if (mGetByIdsChunk > 0 && count > mGetByIdsChunk) {
      CoaError.throw('MysqlCache.MGetByIdsChunkExceeded', `mGetByIds数量超过限制: ${count}/${mGetByIdsChunk}`)
    }
    if (count === 0) return {}
    const result = trx?.__isSafeTransaction ? await super.mGetByIds(uniqueIds, this.columns, trx) : await this.redisCache.mWarp(this.getCacheNsp('id'), uniqueIds, async ids => await super.mGetByIds(ids, this.columns, trx), ms, force)
    _.forEach(result, (v, k) => {
      result[k] = this.pickResult(v, pick)
    })
    return result
  }

  async truncate(trx?: CoaMysql.Transaction) {
    await super.truncate(trx)
    await this.deleteCache([], [])
  }

  async findListCount(finger: Array<CoaMysql.Dic<any>>, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const qb = this.buildListCountQuery(query, trx)
    const cacheId = this.getListCacheId('list-count', finger, qb)
    const worker = async () => {
      const rows = await qb
      return (rows[0]?.count as number) || 0
    }
    return trx?.__isSafeTransaction ? await worker() : await this.cacheWarp(this.getCacheNsp('data'), cacheId, worker)
  }

  async findIdList(finger: Array<CoaMysql.Dic<any>>, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const qb = this.buildIdListQuery(query, trx)
    const cacheId = this.getListCacheId('list', finger, qb)
    const worker = async () => (await qb) as Scheme[]
    return trx?.__isSafeTransaction ? await worker() : await this.cacheWarp(this.getCacheNsp('data'), cacheId, worker)
  }

  async findIdSortList(finger: Array<CoaMysql.Dic<any>>, pager: CoaMysql.Pager, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const built = this.buildIdSortListQuery(pager, query, trx)
    const cacheId = this.getListCacheId(`sort-list:${pager.rows}:${pager.last}`, finger, built.qb, { pager })
    const worker = async () => this.formatIdSortList((await built.qb) as Scheme[], built)
    return trx?.__isSafeTransaction ? await worker() : await this.cacheWarp(this.getCacheNsp('data'), cacheId, worker)
  }

  async findIdViewList(finger: Array<CoaMysql.Dic<any>>, pager: CoaMysql.Pager, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const count = await this.findListCount(finger, query, trx)
    const built = this.buildIdViewListQuery(pager, query, trx, count)
    const cacheId = this.getListCacheId(`view-list:${pager.rows}:${pager.page}`, finger, built.qb, { pager })
    const worker = async () => this.formatIdViewList((await built.qb) as Scheme[], built)
    return trx?.__isSafeTransaction ? await worker() : await this.cacheWarp(this.getCacheNsp('data'), cacheId, worker)
  }

  async mGetCountBy(field: string, ids: string[], trx?: CoaMysql.Transaction) {
    const uniqueIds = _.uniq(ids)
    if (uniqueIds.length === 0) return {}
    const queryFunction = async () => {
      const rows = (await this.table(trx).select({ id: field }).count({ count: this.key }).whereIn(field, uniqueIds).groupBy(field)) as any[]
      const result: CoaMysql.Dic<number> = {}
      _.forEach(rows, ({ id, count }) => (result[id] = count))
      return result
    }
    const result = trx?.__isSafeTransaction ? await queryFunction() : await this.redisCache.mWarp(this.getCacheNsp('count', field), uniqueIds, queryFunction)
    return result
  }

  async getCountBy(field: string, value: string, query?: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const queryFunction = async () => {
      const qb = this.table(trx).count({ count: this.key })
      query ? query(qb) : qb.where(field, value)
      const rows = await qb
      return (rows[0]?.count as number) || 0
    }
    const result = trx?.__isSafeTransaction ? await queryFunction() : await this.cacheWarp(this.getCacheNsp('count', field), value, queryFunction)
    return result
  }

  pickResult<T>(data: T, pick: string[]) {
    if (!data) return null
    return _.pick(data, pick) as T
  }

  getCacheNsp(...nsp: string[]) {
    return this.system + ':' + this.name + ':' + nsp.join(':')
  }

  protected async cacheWarp<T>(nsp: string, id: string, worker: () => Promise<T>, ms?: number, force = false) {
    return await (this.redisCache.warp as any)(nsp, id, worker, ms, force, this.cacheLock) as T
  }

  protected getListCacheId(type: string, finger: Array<CoaMysql.Dic<any>>, qb: any, ext: CoaMysql.Dic<any> = {}) {
    const sql = qb.toSQL()
    return type + ':' + secure.sha1(JSON.stringify({ type, system: this.system, database: this.database, model: this.name, finger, sql: sql.sql, bindings: sql.bindings || [], ext }))
  }

  async getCacheChangedDataList(ids: string[], data?: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    let has = true
    const resultList = [] as Array<CoaMysql.SafePartial<Scheme>>
    if (data) {
      has = _.some(this.cachesFields, i => (data as any)[i] !== undefined)
      resultList.push(data)
    }
    if (has) {
      const data = await this.mGetByIds(ids, this.columns, trx, 0)
      resultList.push(..._.values(data))
    }
    return resultList
  }

  async deleteCache(ids: string[], dataList: Array<CoaMysql.SafePartial<Scheme>>, trx?: CoaMysql.Transaction) {
    const deleteIds = [] as CoaRedis.CacheDelete[]
    if (trx?.__isSafeTransaction) {
      (trx as any)?.clearCacheNsps.push([this.getCacheNsp('id'), ids]);
      (trx as any)?.clearCacheNsps.push([this.getCacheNsp('data'), []])
    } else {
      deleteIds.push([this.getCacheNsp('id'), ids])
      deleteIds.push([this.getCacheNsp('data'), []])
    }
    _.forEach(this.caches, (items, name) => {
      // name可能为index,count,或自定义
      items.forEach(item => {
        const keys = item.split(/[:,]/)
        const key = keys[0]
        const ids = [] as string[]
        dataList.forEach((data: any) => {
          data?.[key] && ids.push(data[key])
        })
        ids.push(...keys.slice(1))
        if (ids.length) {
          (trx?.__isSafeTransaction) ? (trx as any)?.clearCacheNsps.push([this.getCacheNsp(name, key), ids]) : deleteIds.push([this.getCacheNsp(name, key), ids])
        }
      })
    })
    if (!trx?.__isSafeTransaction) await this.redisCache.mDelete(deleteIds)
  }
}
