import { RedisCache } from 'blue-fish-redis';
import { CoaMysql, MysqlBin, MysqlCache, MysqlStorage, MysqlUuid } from '..';
import cMysql from './cMysql';
import cRedis from './cRedis';
// 配置项
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
  },
};

// 初始化配置
const config = ConfigMap;
const bin = new MysqlBin(config);
const uuid = new MysqlUuid(bin, 'ID');
const ouid = new MysqlUuid(bin, 'ORDER', 99000);
const quid = new MysqlUuid(bin, 'QUOTA', 99000); // 额度订单ID
const storage = new MysqlStorage(bin, cRedis.cache);

// MysqlCache 基类
export class cMysqlCache<Scheme> extends MysqlCache<Scheme> {
  redisCache: RedisCache;

  constructor(option: CoaMysql.ModelOption<Scheme>, bin: MysqlBin, redisCache: RedisCache) {
    super(option, bin, redisCache);
    this.redisCache = redisCache;
  }
}

// MysqlNativeModel 子类
export class MysqlNativeModel<T> extends MysqlCache<BizAccountStorage.Scheme> {
  constructor(option: CoaMysql.ModelOption<T>) {
    // 合并配置对象
    const config = {
      name: 'BizAccountStorage',
      title: '用户字段存储',
      prefix: 'basage',
      scheme,
      pick,
      caches,
    };
    // 调用父类构造函数
    super({ ...option, ...config }, bin, cRedis.cache);
  }

  async newId() {
    return this.prefix + (await uuid.hexId()) + '11'
  }

  // 定义一个通用方法
  async c() {
    // await cMysql.
    await cMysql.transaction(async (trx: any) => {
      await this.insert({ key: 'a' }, trx)
      await this.insert({ key: 'b' }, trx)
      // await this.findIdList(()=>{})
    })
  }
  async getList(where: { status: number }, where2: { search: string }) {
    const query: Query = (qb) => {
      qb.filter(where)
      qb.search(['appId'], where2.search)
    }

    const list = await this.findIdList([where, where2], query)

    return list
  }

}

// BizAccountStorage 相关类型声明
export declare namespace BizAccountStorage {
  type Scheme = typeof scheme;
  type PartialScheme = Partial<Scheme>;
}

// 其它导出
export default new (class {
  public uuid = uuid;
  public ouid = ouid;
  public quid = quid;
  public storage = storage;
  public io = bin.io;
  public bin = bin;
})();


// Redis缓存对象
const scheme = {
  stoageId: '',
  key: '' as string,
  value: {},
  created: 0,
  updated: 0,
};

const pick = ['stoageId', 'key', 'value'];
const caches = {};
const modelInstance = new MysqlNativeModel({
  name: 'BizAccountStorage',
  title: '用户字段存储',
  prefix: 'basage',
  scheme,
  pick,
  caches,
});

modelInstance.c();