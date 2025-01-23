import { CoaError } from 'coa-error'
import { $, _ } from 'coa-helper'
import { CoaRedis, RedisCache } from 'coa-redis'
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


  // 事务上下文管理

  private static getTransactionContext(trx?: CoaMysql.Transaction) {

    if (!trx) CoaError.throw('MysqlCache.MissingTransaction', '缺少事务上下文');

    trx.userParams.context = trx.userParams.context || { callbacks: [] }; // 初始化事务上下文
    return trx.userParams.context;
  }
  // 记录回调到事务上下文

  private static addCallback(trx: CoaMysql.Transaction, callback: () => Promise<void>) {
    const context = this.getTransactionContext(trx);

    context.callbacks.push(callback);
  }
  // 在事务提交成功后调用回调

  private static async executeCallbacks(trx: CoaMysql.Transaction) {
    const context = this.getTransactionContext(trx);
    for (const callback of context.callbacks) {
      await callback();
    }
  }

  // 抽象出的删除缓存的异步函数

  async createDeleteCachePromise(ids: any[], dataList: any[], trx?: CoaMysql.Transaction) {
    await this.deleteCache(ids, dataList);
  }

  async insert(data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const id = await super.insert(data, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, [id], [data], trx);
    trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise();

    return id;
  }

  async mInsert(dataList: Array<CoaMysql.SafePartial<Scheme>>, trx?: CoaMysql.Transaction) {
    const ids = await super.mInsert(dataList, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, ids, dataList, trx);
    trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise();
    return ids;
  }

  async updateById(id: string, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, [id], dataList, trx);
    const result = await super.updateById(id, data, trx);
    trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise();
    return result;
  }

  async updateByIds(ids: string[], data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList(ids, data, trx);
    const result = await super.updateByIds(ids, data, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, ids, dataList, trx);
    result && (trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise());
    return result;
  }

  async updateForQueryById(id: string, query: CoaMysql.Query, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx);
    const result = await super.updateForQueryById(id, query, data, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, [id], dataList, trx);
    result && (trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise());
    return result;
  }

  async upsertById(id: string, data: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList([id], data, trx);
    const result = await super.upsertById(id, data, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, [id], dataList, trx);
    trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise();
    return result;
  }

  async deleteByIds(ids: string[], trx?: CoaMysql.Transaction) {
    const dataList = await this.getCacheChangedDataList(ids, undefined, trx);
    const result = await super.deleteByIds(ids, trx);
    const deleteCachePromise = this.createDeleteCachePromise.bind(this, ids, dataList, trx);
    result && (trx ? MysqlCache.addCallback(trx, deleteCachePromise) : await deleteCachePromise());
    return result;
  }

  async checkById(id: string, pick = this.columns, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    return (await this.getById(id, pick, trx, ms, force)) ?? CoaError.throw('MysqlCache.DataNotFound', `${this.title}不存在`)
  }

  async getById(id: string, pick = this.columns, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    const result = await this.redisCache.warp(this.getCacheNsp('id'), id, async () => await super.getById(id, this.columns, trx), ms, force)
    return this.pickResult(result, pick)
  }

  async getIdBy(field: string, value: string | number, trx?: CoaMysql.Transaction) {
    return await this.redisCache.warp(this.getCacheNsp('index', field), '' + value, async () => await super.getIdBy(field, value, trx))
  }

  async mGetByIds(ids: string[], pick = this.pick, trx?: CoaMysql.Transaction, ms = this.ms, force = false) {
    const result = await this.redisCache.mWarp(this.getCacheNsp('id'), ids, async ids => await super.mGetByIds(ids, this.columns, trx), ms, force)
    _.forEach(result, (v, k) => {
      result[k] = this.pickResult(v, pick)
    })
    return result
  }

  async truncate(trx?: CoaMysql.Transaction) {
    await super.truncate(trx)
    await this.deleteCache([], [])
  }

  async executeTransaction(trx: CoaMysql.Transaction, task: () => Promise<void>) {
    try {
      await task(); // 执行事务内的逻辑
      await trx.commit(); // 提交事务
      await MysqlCache.executeCallbacks(trx); // 提交成功后执行回调
    } catch (err) {
      await trx.rollback(); // 回滚事务
      throw err; // 抛出异常
    }
  }

  protected async findListCount(finger: Array<CoaMysql.Dic<any>>, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('data')
    const cacheId = 'list-count:' + secure.sha1($.sortQueryString(...finger))
    return await this.redisCache.warp(cacheNsp, cacheId, async () => await super.selectListCount(query, trx))
  }

  protected async findIdList(finger: Array<CoaMysql.Dic<any>>, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('data')
    const cacheId = 'list:' + secure.sha1($.sortQueryString(...finger))
    return await this.redisCache.warp(cacheNsp, cacheId, async () => await super.selectIdList(query, trx))
  }

  protected async findIdSortList(finger: Array<CoaMysql.Dic<any>>, pager: CoaMysql.Pager, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('data')
    const cacheId = `sort-list:${pager.rows}:${pager.last}:` + secure.sha1($.sortQueryString(...finger))
    return await this.redisCache.warp(cacheNsp, cacheId, async () => await super.selectIdSortList(pager, query, trx))
  }

  protected async findIdViewList(finger: Array<CoaMysql.Dic<any>>, pager: CoaMysql.Pager, query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('data')
    const cacheId = `view-list:${pager.rows}:${pager.page}:` + secure.sha1($.sortQueryString(...finger))
    const count = await this.findListCount(finger, query, trx)
    return await this.redisCache.warp(cacheNsp, cacheId, async () => await super.selectIdViewList(pager, query, trx, count))
  }

  protected async mGetCountBy(field: string, ids: string[], trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('count', field)
    return await this.redisCache.mWarp(cacheNsp, ids, async ids => {
      const rows = (await this.table(trx).select({ id: field }).count({ count: this.key }).whereIn(field, ids).groupBy(field)) as any[]
      const result: CoaMysql.Dic<number> = {}
      _.forEach(rows, ({ id, count }) => (result[id] = count))
      return result
    })
  }

  protected async getCountBy(field: string, value: string, query?: CoaMysql.Query, trx?: CoaMysql.Transaction) {
    const cacheNsp = this.getCacheNsp('count', field)
    return await this.redisCache.warp(cacheNsp, value, async () => {
      const qb = this.table(trx).count({ count: this.key })
      query ? query(qb) : qb.where(field, value)
      const rows = await qb
      return (rows[0]?.count as number) || 0
    })
  }

  protected pickResult<T>(data: T, pick: string[]) {
    if (!data) return null
    return _.pick(data, pick) as T
  }

  protected getCacheNsp(...nsp: string[]) {
    return this.system + ':' + this.name + ':' + nsp.join(':')
  }

  protected async getCacheChangedDataList(ids: string[], data?: CoaMysql.SafePartial<Scheme>, trx?: CoaMysql.Transaction) {
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


  protected async deleteCache(ids: string[], dataList: Array<CoaMysql.SafePartial<Scheme>>) {
    console.log('删除了缓存');

    const deleteIds = [] as CoaRedis.CacheDelete[]
    deleteIds.push([this.getCacheNsp('id'), ids])
    deleteIds.push([this.getCacheNsp('data'), []])
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
        ids.length && deleteIds.push([this.getCacheNsp(name, key), ids])
      })
    })
    await this.redisCache.mDelete(deleteIds)
  }
}
