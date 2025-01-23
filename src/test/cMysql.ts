import { CoaMysql, MysqlBin, MysqlCache, MysqlNative, MysqlStorage, MysqlUuid } from '..'
import cRedis from './cRedis'

const ConfigMap = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '19990728',
  charset: 'utf8mb4',
  trace: true,
  debug: false,
  databases: {
    main: { database: 'mm-site-t1', ms: 7 * 24 * 3600 * 1000 },

  }
}

const config = ConfigMap
const bin = new MysqlBin(config)
const uuid = new MysqlUuid(bin, 'ID')
const ouid = new MysqlUuid(bin, 'ORDER', 99000)
const quid = new MysqlUuid(bin, 'QUOTA', 99000) // 额度订单ID
const storage = new MysqlStorage(bin, cRedis.cache)

const transaction = async (task: (trx: CoaMysql.Transaction) => Promise<void>) => {
  return await bin.io.transaction(async (trx: CoaMysql.Transaction) => {
    // 使用包装函数
    await storage.executeTransaction(trx, async () => {
      await task(trx); // 这里显式传递 trx
    });
  });
}
export class MysqlNatived<Schema> extends MysqlNative<Schema> {
  constructor(option: CoaMysql.ModelOption<Schema>) {
    super(option, bin)
  }

}

export class MysqlCached<Schema> extends MysqlCache<Schema> {
  constructor(option: CoaMysql.ModelOption<Schema>) {
    super(option, bin, cRedis.cache)
  }
}

export default new (class {
  public uuid = uuid
  public ouid = ouid
  public quid = quid
  public storage = storage
  public io = bin.io
  public bin = bin
  public transaction = transaction


})()

declare global {
  type Query = CoaMysql.Query
  type Pager = CoaMysql.Pager
  type Transaction = CoaMysql.Transaction
  type QueryBuilder = CoaMysql.QueryBuilder
}
