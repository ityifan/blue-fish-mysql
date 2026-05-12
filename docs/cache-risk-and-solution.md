# blue-fish-mysql 与 blue-fish-redis 缓存风险与改造方案

## 背景

`blue-fish-mysql` 的 `MysqlCache` 基于 `blue-fish-redis` 的 `RedisCache.warp/mWarp` 做自动缓存。当前缓存结构大致是：

```txt
Redis key:   {redisPrefix}:{system}:{model}:{cacheType}
Hash field: 业务 id / 查询指纹
Hash value: [expire, value]
```

例如：

```txt
main:order:id
main:order:data
main:order:index:orderNo
main:order:count:status
```

当前实现里有三个需要一起解决的问题：

1. 缓存过期瞬间，同一个 key 的并发请求会同时打 MySQL，形成缓存击穿。
2. 写操作会全量清理列表缓存，导致列表缓存失效风暴。
3. 列表缓存 key 只依赖外部传入的 `finger`，不依赖真实 SQL 条件，可能命中语义不同的列表缓存。

另外，订单表已经做了 32 张分表，这对数据库压力有缓解作用，但不能替代缓存层的请求合并、租户隔离和查询指纹修正。

## 当前实现事实

### 1. RedisCache.warp 没有请求合并

`RedisCache.warp` 当前逻辑是：

```ts
let result = force ? undefined : await this.get(nsp, id)
if (result === undefined) {
  result = await worker()
  ms > 0 && (await this.set(nsp, id, result, ms))
}
return result
```

也就是：

```txt
读缓存 -> miss -> 查 DB -> 写缓存
```

这里没有对同一个 `nsp + id` 做并发请求合并。

相关位置：

- `blue-fish-redis/src/RedisCache.ts`
- `RedisCache.warp`
- `RedisCache.mWarp`

### 2. MysqlCache 写操作会整桶删除列表缓存

`MysqlCache.deleteCache` 当前会删除：

```ts
deleteIds.push([this.getCacheNsp('id'), ids])
deleteIds.push([this.getCacheNsp('data'), []])
```

其中 `ids` 为空数组时，`RedisCache.delete(nsp, [])` 会执行 `del` 整个 Redis hash。

也就是说任意一次写操作都会删除整个：

```txt
{prefix}:{system}:{model}:data
```

这会让当前模型下所有列表缓存同时失效。

相关位置：

- `blue-fish-mysql/src/services/MysqlCache.ts`
- `MysqlCache.deleteCache`
- `RedisCache.delete`

### 3. 列表缓存 key 只使用 finger，不使用真实 SQL

`findIdList` 当前缓存 key：

```ts
const cacheId = 'list:' + secure.sha1($.sortQueryString(...finger))
```

`findIdSortList/findIdViewList/findListCount` 也是类似逻辑。

这意味着：缓存 key 只由调用方传入的 `finger` 决定，不由 `query(qb)` 最终生成的 SQL 决定。

如果两个调用传入相同 `finger`，但内部 `query(qb)` 条件不同，它们会得到同一个 `cacheId`，从而命中同一个列表缓存。

## 问题一：缓存击穿

### 场景

某个热点 key 过期：

```txt
order:id:10001 过期
```

同一瞬间 500 个请求进来：

```txt
500 个请求同时 getById('10001')
```

当前流程会变成：

```txt
500 个请求读 Redis
500 个请求都 miss
500 个请求都执行 worker
500 个请求都打 MySQL
```

### 风险

- MySQL 瞬时 QPS 暴涨。
- 热点 key 越热，过期瞬间越危险。
- 多个热点 key 同时过期时，会放大成缓存雪崩。
- 如果 DB 慢，请求堆积会进一步拖慢应用线程。

### 推荐方案：同 key 请求合并

核心规则：

```txt
同一个 nsp + id 同时 miss 时，只允许一个请求执行 worker。
其他请求等待这个 worker 的 Promise。
worker 成功后，所有等待请求复用同一个结果。
worker 失败后，释放合并状态，让后续请求可以重试。
```

建议先做进程内请求合并：

```ts
private readonly pending = new Map<string, Promise<any>>()

async warp<T>(nsp: string, id: string, worker: () => Promise<T>, ms = ms_ttl, force = false) {
  const cacheKey = `${nsp}:${id}`

  const cached = force ? undefined : await this.get(nsp, id)
  if (cached !== undefined) return cached as T

  const pending = this.pending.get(cacheKey)
  if (pending) return await pending

  const promise = worker()
    .then(async result => {
      ms > 0 && await this.set(nsp, id, result, ms)
      return result
    })
    .finally(() => {
      this.pending.delete(cacheKey)
    })

  this.pending.set(cacheKey, promise)
  return await promise
}
```

`mWarp` 需要按 miss id 拆分处理：

```txt
先 mGet(ids)
找出 missIds
对每个 missId 判断是否已有 pending
已有 pending 的等待
没有 pending 的合并成一次 worker 查询
worker 返回后分别 set 对应 pending 结果
```

### 可选增强：Redis 分布式锁

如果服务是多实例部署，进程内请求合并只能保证单进程内合并。

例如 10 个 Node 实例同时收到请求：

```txt
每个实例最多一个请求查 DB
最终仍可能有 10 次 DB 查询
```

如果希望跨实例也只查一次，可以增加 Redis 分布式锁：

```txt
lock key: cache-warp:{nsp}:{id}
```

流程：

1. miss 后先尝试获取 Redis 锁。
2. 获取锁的请求执行 worker 并回填缓存。
3. 未获取锁的请求短暂等待后重读缓存。
4. 等待超时后可以降级为自己查 DB，避免死等。

### 好处

- 直接降低热点 key 过期瞬间的 DB 峰值压力。
- 对业务调用方基本无感知。
- 进程内方案成本低，适合作为默认能力。
- 分布式锁方案可以作为高并发场景的可选能力。

### 坏处

- 进程内方案不能跨实例合并。
- 分布式锁方案会增加 Redis 操作次数。
- 锁超时时间需要谨慎设置，过短可能重复查，过长会拖慢失败恢复。
- `mWarp` 实现复杂度比单 key 高。

## 问题二：列表缓存全量清理导致失效风暴

### 场景

当前所有列表缓存都放在：

```txt
main:order:data
```

里面可能有：

```txt
list:hash1
list:hash2
view-list:20:1:hash3
sort-list:20:0:hash4
```

任意一条订单更新后，会删除整个：

```txt
main:order:data
```

### 风险

- 一个租户的数据更新，导致所有租户的列表缓存一起失效。
- 所有列表请求同时 miss。
- 所有请求都回源 MySQL。
- 写入频繁时，列表缓存刚热起来就被删掉，长期处于冷缓存状态。

### 推荐方案：多租户缓存隔离

不再把所有租户的列表缓存放在同一个 `data` 命名空间，而是按租户维度拆分。

例如按 `accountId` 隔离：

```txt
main:order:scope:accountId=10001:data
main:order:scope:accountId=10002:data
```

按 `appId` 隔离：

```txt
main:order:scope:appId=wxa001:data
main:order:scope:appId=wxa002:data
```

组合隔离：

```txt
main:order:scope:accountId=10001:appId=wxa001:data
```

更新 `accountId=10001` 的订单时，只删除：

```txt
main:order:scope:accountId=10001:data
```

不会影响 `accountId=10002`。

### 配置建议

建议在 `ModelOption` 上新增 `cacheScope` 配置。

```ts
cacheScope?: {
  fields: string[]
  applyTo?: Array<'data' | 'count' | 'index' | 'id'>
  required?: boolean
}
```

订单表示例：

```ts
const orderModelOption = {
  name: 'Order',
  scheme,
  pick,
  cacheScope: {
    fields: ['accountId'],
    applyTo: ['data', 'count'],
    required: true,
  },
}
```

配置含义：

- `fields`: 租户隔离字段，例如 `accountId`、`appId`、`tenantId`。
- `applyTo`: 哪些缓存类型启用隔离。列表缓存 `data` 通常必须启用。
- `required`: 是否强制调用方提供或框架能推导出 scope。

### 查询参数建议

列表查询方法增加最后一个可选参数：

```ts
type CacheOption = {
  scope?: Record<string, string | number>
  ms?: number
  force?: boolean
  fingerprint?: string | Record<string, any>
}
```

调用示例：

```ts
await Order.findIdList(
  [where, search],
  query,
  trx,
  {
    scope: { accountId },
  }
)
```

为了兼容旧调用，建议新增参数放最后：

```ts
findListCount(finger, query, trx?, cacheOption?)
findIdList(finger, query, trx?, cacheOption?)
findIdSortList(finger, pager, query, trx?, cacheOption?)
findIdViewList(finger, pager, query, trx?, cacheOption?)
```

### 更新参数建议

写操作也可以增加 `cacheOption`：

```ts
updateById(id, data, trx?, cacheOption?)
updateByIds(ids, data, trx?, cacheOption?)
deleteByIds(ids, trx?, cacheOption?)
```

不过更新和删除时，不建议完全依赖调用方传入 scope。

更稳妥的规则是：

1. 先读取变更前的数据。
2. 从旧数据里提取 scope。
3. 从新数据里提取 scope。
4. 同时删除旧 scope 和新 scope 的列表缓存。

这样即使一条数据从 `accountId=10001` 移到 `accountId=10002`，也能同时清理：

```txt
main:order:scope:accountId=10001:data
main:order:scope:accountId=10002:data
```

### key 设计建议

实体缓存：

```txt
nsp: main:order:id
id:  orderId
```

列表缓存：

```txt
nsp: main:order:scope:accountId=10001:data
id:  list:{fingerprintHash}
```

count 缓存：

```txt
nsp: main:order:scope:accountId=10001:count:status
id:  paid
```

index 缓存：

```txt
nsp: main:order:scope:accountId=10001:index:orderNo
id:  NO123
```

如果主键全局唯一，`id` 缓存可以不加租户 scope，避免重复缓存同一条数据。

如果主键不是全局唯一，或者有强隔离要求，`id` 缓存也应加入 scope：

```txt
nsp: main:order:scope:accountId=10001:id
id:  orderId
```

### 过期时间建议

当前 `main: { ms: 7 * 24 * 3600 * 1000 }` 会被 `MysqlNative` 读到 `this.ms`。

但需要注意：

- `getById/mGetByIds` 当前会显式传 `this.ms`。
- `findIdList/findListCount/findIdSortList/findIdViewList/getIdBy/getCountBy/mGetCountBy` 当前没有显式传 `this.ms`，会走 `RedisCache` 的默认 30 天。

建议把缓存 TTL 拆成按类型配置：

```ts
databases: {
  main: {
    database: 'mm-site-t1',
    ms: 7 * 24 * 3600 * 1000,
    cacheMs: {
      id: 7 * 24 * 3600 * 1000,
      index: 24 * 3600 * 1000,
      count: 10 * 60 * 1000,
      data: 5 * 60 * 1000,
    },
  },
}
```

建议默认值：

```txt
id:    1 到 7 天
index: 1 到 7 天
count: 5 到 30 分钟
data:  1 到 10 分钟
```

列表缓存数据量在多租户隔离后会明显增加，所以 `data` 不建议继续使用 7 天或 30 天这种长 TTL。

### 好处

- 一个租户写入不会打掉所有租户的列表缓存。
- 列表缓存更容易保持热度。
- MySQL 峰值压力更平滑。
- 缓存边界和业务租户边界一致，排查问题更直观。

### 坏处

- Redis key 数量会上升。
- Redis 总缓存体积会上升。
- 查询和写入 API 需要支持 scope。
- 表配置复杂度上升。
- 数据迁移租户时需要清理旧 scope 和新 scope。

## 问题三：findIdList 查询语义不同但缓存 key 相同

### 问题是否存在

存在。

当前 `findIdList` 的缓存 key 只由 `finger` 决定：

```ts
const cacheId = 'list:' + secure.sha1($.sortQueryString(...finger))
```

如果有两个调用：

```ts
await Order.findIdList(
  [{ accountId: '10001' }],
  qb => {
    qb.where('accountId', '10001')
    qb.where('status', 'paid')
  }
)

await Order.findIdList(
  [{ accountId: '10001' }],
  qb => {
    qb.where('accountId', '10001')
    qb.where('status', 'closed')
  }
)
```

这两个调用的 `finger` 一样，最终会生成同一个：

```txt
list:{sha1([{ accountId: '10001' }])}
```

但真实 SQL 条件不同。

结果是：

```txt
paid 列表可能命中 closed 列表缓存
closed 列表也可能命中 paid 列表缓存
```

这属于缓存 key 的查询语义不完整问题。

### 风险

- 返回错误的 id 列表。
- 业务层再通过 `mGetByIds` 查实体时，实体数据本身可能是对的，但列表 id 集合已经错了。
- 问题不稳定，取决于谁先写入缓存。
- 排查困难，因为传参看起来一致，真正差异藏在 `query(qb)` 内部。

### 推荐方案：缓存指纹必须包含真实 SQL 与 bindings

最佳方案是让列表缓存指纹由两部分组成：

```txt
业务 finger + 真实 SQL + SQL bindings + pager + count 参数
```

也就是：

```ts
const fingerprint = {
  finger,
  sql,
  bindings,
  pager,
  type: 'list',
}

const cacheId = 'list:' + sha1(stableStringify(fingerprint))
```

这样只要 `query(qb)` 最终生成的 SQL 不一致，缓存 key 就一定不一致。

### 实现方向

当前 `MysqlCache.findIdList` 直接把 `query` 传给 `super.selectIdList`，`MysqlCache` 自己拿不到最终 SQL。

建议重构一个“构建查询但不执行”的内部方法：

```ts
protected buildIdListQuery(query: CoaMysql.Query, trx?: CoaMysql.Transaction) {
  const qb = this.table(trx).select(this.name + '.' + this.key)
  query(qb)
  qb.orderBy(this.name + '.' + this.increment, 'desc')
  return qb
}
```

然后：

```ts
const qb = this.buildIdListQuery(query, trx)
const sqlInfo = qb.toSQL()
const cacheId = this.getListCacheId('list', finger, sqlInfo)

return await this.redisCache.warp(
  this.getCacheNsp('data'),
  cacheId,
  async () => await qb
)
```

`findIdSortList/findIdViewList/findListCount` 也要同样处理。

### 兼容方案：显式 queryKey

如果短期不想重构 SQL 生成逻辑，可以先要求调用方显式传 `queryKey`：

```ts
await Order.findIdList(
  [where],
  query,
  trx,
  {
    fingerprint: {
      name: 'order.list.byAccountAndPaidStatus',
      where,
      status: 'paid',
    },
  }
)
```

然后缓存 key 使用：

```txt
finger + cacheOption.fingerprint
```

但这个方案依赖调用方自觉，容易漏。

因此推荐优先级：

```txt
真实 SQL + bindings 指纹 > 显式 queryKey > 只靠 finger
```

### 防御性策略

可以在开发或 trace 模式下加校验：

```txt
同一个 finger 在进程内出现多个不同 SQL 时，打印 warning。
```

这样能提前发现“finger 没覆盖完整查询语义”的调用点。

## 订单表 32 分表对这个需求的影响

订单表分成 32 张表，对多租户场景是有帮助的，但它缓解的是数据库层面的单表压力，不是完整解决缓存层问题。

### 能缓解什么

如果分表规则和租户维度有关，例如：

```txt
shard = hash(accountId) % 32
```

那么它可以缓解：

- 单表数据量过大。
- 单表索引过大。
- 某些查询只落到一个分表，减少扫描范围。
- 写入压力分散到 32 张物理表。
- 缓存失效回源 DB 时，DB 压力会分散到不同分表。

也就是说，分表能降低“回源 MySQL 后每张表承受的压力”。

### 不能解决什么

分表不能解决：

- 同一个 key 过期后 500 个请求同时查 DB。
- 列表缓存被整桶删除后所有租户同时 miss。
- `finger` 一样但 SQL 不一样导致命中错误缓存。
- 应用层缓存 key 粒度过粗。
- Redis 缓存数量和 TTL 不合理。

例如某个大租户订单都落在同一个分表：

```txt
order_07
```

当这个租户的热点列表缓存失效时，大量请求仍然会同时打：

```txt
order_07
```

如果没有请求合并，32 分表并不能阻止这个热点分表被打爆。

### 和多租户缓存隔离的关系

分表和多租户缓存隔离可以互相配合。

推荐 key 包含租户 scope，必要时也包含 shard 信息：

```txt
main:order:shard:07:scope:accountId=10001:data
```

但是否需要把 `shard` 放进 cache key，要看模型层是否已经按分表实例隔离。

如果一个 `OrderModel` 实例只负责一张分表，`model name` 或 `system` 已经能区分分表，则不一定要加 shard。

如果同一个 `OrderModel` 内部动态路由 32 张表，则缓存 key 必须能区分 shard，否则不同分表的相同查询可能互相污染。

建议规则：

```txt
缓存 key 必须包含所有会影响最终 SQL 数据范围的维度。
```

这些维度包括：

- system/database
- model/table
- shard
- tenant scope
- query SQL
- query bindings
- pager
- sort
- list/count 类型

## 综合落地建议

### 第一阶段：低风险修复

1. 给 `RedisCache.warp` 加进程内 singleflight。
2. 给 `RedisCache.mWarp` 加 per-id singleflight。
3. `MysqlCache` 所有缓存调用显式传入 TTL，避免列表缓存隐式使用 30 天默认值。
4. 给列表缓存指纹增加 `queryKey` 可选参数，作为短期兼容方案。

### 第二阶段：修正列表缓存 key

1. 重构列表查询构建逻辑，让 `MysqlCache` 能拿到 `qb.toSQL()`。
2. 列表缓存 key 纳入真实 SQL 和 bindings。
3. `findIdList/findIdSortList/findIdViewList/findListCount` 使用统一的 `buildCacheFingerprint`。
4. 在 trace/debug 模式下提示相同 finger 对应不同 SQL 的风险。

### 第三阶段：多租户缓存隔离

1. `ModelOption` 增加 `cacheScope` 配置。
2. 查询方法增加 `cacheOption.scope`。
3. 写操作根据旧数据和新数据推导 scope。
4. `deleteCache` 从全量删除 `data` 改为删除对应 scope 下的 `data`。
5. 对 `required: true` 的模型，无法推导 scope 时直接抛错。

### 第四阶段：高并发增强

1. 热点模型可选启用 Redis 分布式锁请求合并。
2. 给缓存 TTL 增加随机抖动，避免大量 key 同时过期。
3. 对空结果继续做短 TTL 缓存，避免缓存穿透。
4. 增加缓存命中率、回源次数、singleflight 合并次数等指标。

## 推荐最终 API 形态

```ts
type CacheScope = Record<string, string | number>

type CacheOption = {
  scope?: CacheScope
  ms?: number
  force?: boolean
  fingerprint?: string | Record<string, any>
}

interface ModelOption<T> {
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
  cacheScope?: {
    fields: string[]
    applyTo?: Array<'id' | 'index' | 'count' | 'data'>
    required?: boolean
  }
}
```

调用示例：

```ts
await Order.findIdList(
  [where, search],
  qb => {
    qb.where('accountId', accountId)
    qb.where('status', status)
    qb.search(['orderNo', 'buyerName'], keyword)
  },
  undefined,
  {
    scope: { accountId },
    fingerprint: { status, keyword },
  }
)
```

最终缓存 key 应该由框架生成，而不是完全依赖调用方：

```txt
nsp:
main:order:scope:accountId=10001:data

id:
list:{sha1({
  type: 'list',
  finger,
  sql,
  bindings,
  pager,
  fingerprint
})}
```

## 总结

三个问题需要一起看：

1. 缓存击穿是并发控制问题，用同 key 请求合并解决。
2. 列表缓存全量清理是缓存粒度问题，用多租户 scope 隔离解决。
3. `findIdList` 错命中是缓存指纹问题，用真实 SQL + bindings 参与 key 生成解决。

订单 32 分表可以降低数据库单表压力，但不能替代缓存层治理。更合理的组合是：

```txt
32 分表降低 DB 单表压力
singleflight 降低同 key 回源并发
tenant scope 降低列表失效范围
SQL fingerprint 保证缓存语义正确
短 TTL + 抖动降低过期风暴
```

