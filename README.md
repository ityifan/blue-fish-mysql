# blue-fish-mysql

[![GitHub license](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/blue-fish-mysql.svg?style=flat-square)](https://www.npmjs.org/package/blue-fish-mysql)
[![npm downloads](https://img.shields.io/npm/dm/blue-fish-mysql.svg?style=flat-square)](http://npm-stat.com/charts.html?package=blue-fish-mysql)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/coajs/blue-fish-mysql/pulls)

English | [简体中文](README.zh-CN.md)

MySQL database components for coajs, including basic data models, cache data models, distributed ID, etc.

## Feature

- **Functional**: Basic data connection based on [mysql](https://github.com/mysqljs/mysql)，SQL query based on [knex](https://github.com/knex/knex). Pay attention to performance, full-featured, including original library all use methods
- **Lightweight**: No more than 1,000 lines of code, do not rely on other third-party libraries
- **Fast and Convenient**: Basic data model comes with CRUD operation, no extra code
- **Automatic Cache**: Cache data model automatically performs data cache management (cache generation, cache elimination, etc.), cache is based on[blue-fish-redis](https://github.com/coajs/blue-fish-redis)
- **TypeScript**: All written in TypeScript, type constraint, IDE friendship

## Component

- Basic data model `MysqlNative`: Automatically implement basic CRUD
- Cache data model `MysqlCache`: Take over data cache logic on the basic data model
- Distributed ID `MysqlUuid`: Lightweight distributed UUID
  
## Bug
It is best to rewrite the transaction method in MySQL config after fixing the caching issue of the transaction

```typescript

import cRedis from 'app/cRedis';
import { CoaMysql, MysqlBin, MysqlCache, MysqlNative, MysqlStorage, MysqlUuid } from 'blue-fish-mysql';
import { CoaError } from 'coa-error';
const cConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    charset: 'utf8mb4',
    trace: true,
    debug: false,

    databases: {
        main: { database: 'my-databases', ms: 7 * 24 * 3600 * 1000 },
    },
}
const transaction = async (task: (trx: CoaMysql.Transaction) => Promise<any>) => {
    let list: any = []
    await bin.io.transaction(async (trx: CoaMysql.Transaction) => {
        await storage.executeTransaction(trx, async () => {
            await task(trx);
        });
        list = trx.context.callbacks
    });
    await Promise.all(list.map((callback: any) => callback()));
};


const config = cConfig
const bin = new MysqlBin(config)
const uuid = new MysqlUuid(bin, 'ID')
const ouid = new MysqlUuid(bin, 'ORDER', 99000)
const quid = new MysqlUuid(bin, 'QUOTA', 99000) // 额度订单ID
const storage = new MysqlStorage(bin, cRedis.cache)


const suffix = ''
export class MysqlNatived<Schema> extends MysqlNative<Schema> {
    constructor(option: CoaMysql.ModelOption<Schema>) {
        super(option, bin)
    }

    async newId() {
        return this.prefix + (await uuid.hexId()) + suffix
    }

    async checkById(id: string, pick = this.columns, trx?: CoaMysql.Transaction) {
        return (await this.getById(id, pick, trx)) ?? CoaError.throw('MysqlNative.DataNotFound', `${this.title}不存在`)
    }
}

export class MysqlCached<Schema> extends MysqlCache<Schema> {
    constructor(option: CoaMysql.ModelOption<Schema>) {
        super(option, bin, cRedis.cache)
    }

    async newId() {
        return this.prefix + (await uuid.hexId()) + suffix
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
    type QueryBuilder = any
}

```
Use the following

```typescript
        await cMysql.transaction(async (trx: Knex.Transaction) => {
            const result = await mBizAccountStorage.insert({ key: 'a' }, trx);
            await mBizAccountStorage.insert({ key: 'b' }, trx);
            await mBizAccountStorage.updateById('basage8a3dac2da51d446d', { key: 'q' }, trx)
        });
```
## Quick Start

### Install

```shell
yarn add blue-fish-mysql
```

### Instance configuration

```typescript
import { MysqlBin } from 'blue-fish-mysql'

// MySQL configuration
const mysqlConfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  charset: 'utf8mb4',
  trace: true,
  debug: false,
  databases: {
    main: { database: 'test', ms: 7 * 24 * 3600 * 1000 },
    other: { database: 'other', ms: 7 * 24 * 3600 * 1000 },
  },
}

// Initialize MySQL basic connection,
// follow-up all models depend on this example
const mysqlBin = new MysqlBin(mysqlConfig)
```

### Basic SQL query

New user table `user`, the table structure is as follows

```shell
CREATE TABLE `user` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT 'Self-increased primary key',
  `userId` varchar(32) NOT NULL DEFAULT '' COMMENT 'user ID',
  `name` varchar(64) NOT NULL DEFAULT '' COMMENT 'name',
  `mobile` varchar(16) NOT NULL DEFAULT '' COMMENT 'mobile',
  `avatar` varchar(256) NOT NULL DEFAULT '' COMMENT 'avatar',
  `gender` int(11) NOT NULL DEFAULT '0' COMMENT 'gender, 1 male, 2 female',
  `language` varchar(16) NOT NULL DEFAULT '' COMMENT 'language',
  `status` int(1) NOT NULL DEFAULT '1' COMMENT 'status, 1 normal 2 hidden',
  `created` bigint(20) NOT NULL DEFAULT '0' COMMENT 'Create time',
  `updated` bigint(20) NOT NULL DEFAULT '0' COMMENT 'Update time',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `user_userid_unique` (`userId`) USING BTREE
) COMMENT='User Table';
```

SQL operations on the user table

```typescript
// Insert data, see https://knexjs.org/#Builder-insert
mysqlBin.io.table('user').insert({ userId: 'user-a', name: 'A', mobile: '15010001001', gender: 1, language: 'zh-CN', status: 1 })

// Query all data, see https://knexjs.org/#Builder-select
mysqlBin.io.table('user').select()
mysqlBin.io.select('*').from('user')

// Conditional queries, see https://knexjs.org/#Builder-where
mysqlBin.io.table('user').where('status', '=', 1)

// Update data, see http://knexjs.org/#Builder-update
mysqlBin.io.table('user').update({ name: 'AA', gender: 2 }).where({ userId: 'user-a' })

// Delete data, see http://knexjs.org/#Builder-del%20/%20delete
mysqlBin.io.table('user').delete().where({ userId: 'user-a' })
```

The `io` in this is a `Knex` object, can support **all the usage** of [Knex.js](http://knexjs.org/#Builder)

### Basic data model

In project engineering, in order to ensure the efficiency and rigor of the query, we will not directly operate the SQL statement. Basic data modules can help us implement CURD operations. Define a basic data model `User` by as follows

```typescript
import { MysqlBin, MysqlNative } from 'blue-fish-mysql'

// Define the default structure of User
const userScheme = {
  userId: '' as string,
  name: '' as string,
  mobile: '' as string,
  avatar: '' as string,
  gender: 1 as number,
  language: '' as string,
  status: 1 as number,
  created: 0 as number,
  updated: 0 as number,
}
// Define the User type (automatically generated by the default structure)
type UserScheme = typeof userScheme

// Initialization by base class
const User = new (class extends MysqlNative<UserScheme> {
  constructor() {
    super(
      {
        name: 'User', // Table name, default transformation into a `snackcase` format, such as User->user UserPhoto->user_photo
        title: 'User Table', // Table note name
        scheme: userScheme, // Default structure of the table
        pick: ['userId', 'name'], // Field information displayed when querying the list
      },
      // Binding configuration instance bin
      mysqlBin
    )
  }

  // Custom method
  async customMethod() {
    // Do something
  }
})()
```

Generally, a data sheet corresponds to a model, and after the model is defined, we can operate the model directly to operate the table

```typescript
// Insert
await User.insert({ name: 'Tom', gender: 1 }) // return 'id001', userId = 'id001' of this data

// Batch insert
await User.mInsert([
  { name: 'Tom', gender: 1 },
  { name: 'Jerry', gender: 1 },
]) // return ['id002','id003']

// Update by ID
await User.updateById('id002', { name: 'Lily' }) // return 1

// Batch update by ID array
await User.updateByIds(['id002', 'id003'], { status: 2 }) // return 2

// Update or insert the ID (id exists if updated, if there is no insert)
await User.upsertById('id002', { name: 'Tom', gender: 1 }) // return 1, update one data of userId = 'id02'
await User.upsertById('id004', { name: 'Lily', gender: 1 }) // return 0, insert a new data of userId = 'id04'

// Delete by ID array
await User.deleteByIds(['id003', 'id004']) // return 2

// Query one by ID, the second parameter settings return the data contained in the result
await User.getById('id001', ['name']) // data is {userId:'id001',name:'Tom',gender:1,status:1,...} return {userId:'id001',name:'Tom'}

// Get multiple data by ID array
await User.mGetByIds(['id001', 'id002'], ['name']) // return {id001:{userId:'id001',name:'Tom'},id002:{userId:'id002',name:'Lily'}}

// Truncate table
await User.truncate() // void, do not report an error is to operate successfully

// Custom method
await User.customMethod() // call a custom method
```

In the actual project, we may need to define multiple models, and there are some public methods on each model. At this time, we can abstract a base class model, other models inherit this base class model

```typescript
import { CoaMysql } from 'blue-fish-mysql'

// Define the base class of a model by mysqlBin, each model can use this base class
export class MysqlNativeModel<T> extends MysqlNative<T> {
  constructor(option: CoaMysql.ModelOption<T>) {
    // Configure the instance bin binding
    super(option, mysqlBin)
  }

  // You can also define some general methods
  commonMethod() {
    // do something
  }
}

// Define user model by base model
const User = new (class extends MysqlNativeModel<UserScheme> {
  constructor() {
    super({ name: 'User', title: 'User Table', scheme: userScheme, pick: ['userId', 'name'] })
  }

  // Custom method
  async customMethodForUser() {
    // Do something
  }
})()

// Define Manager model by base model
const Manager = new (class extends MysqlNativeModel<ManagerScheme> {
  constructor() {
    super({ name: 'Manager', title: 'Manager Table', scheme: managerScheme, pick: ['managerId', 'name'] })
  }
})()

// Both user model and manager model can call common method
await User.commonMethod()
await Manager.commonMethod()

// Only user models can call custom method
await User.customMethodForUser()
```

### Cache data model

Based on [blue-fish-redis](https://www.npmjs.com/package/blue-fish-redis) to achieve fast and efficient data cache logic, and **unify the cache, maintain the life cycle of the cache, to ensure the consistency of cache and mysql data**

Need to install `blue-fish-redis` before use, instructions for use to view 

The method of use of cache data model is exactly the same as the basic data model. Only need to replace the `MysqlNative` to be `MysqlCache`

```typescript
import { CoaMysql, MysqlCache } from 'blue-fish-mysql'
import { RedisBin, RedisCache } from 'blue-fish-redis'


const redisCache = new RedisCache(new RedisBin({ host: '127.0.0.1' }))

// Define the base class for a cache data model
export class MysqlCacheModel<T> extends MysqlCache<T> {
  constructor(option: CoaMysql.ModelOption<T>) {
    // Bind the configuration instance and the redisCache instance on this base class
    super(option, mysqlBin, redisCache)
  }
}

// Define cache user model by cache base class
const UserCached = new (class extends MysqlCacheModel<UserScheme> {
  constructor() {
    super({ name: 'User', title: 'User Table', scheme: userScheme, pick: ['userId', 'name'] })
  }
})()

// Query data
await User.getById('id001') // First query will read the database
await User.getById('id001') // The second call will read data directly from the cache

// Insert, delete, update, just like the basic data model
await User.insert({ name: 'Tom', gender: 1 }) // return 'id001'
await User.updateById('id001', { name: 'Lily' }) // return 1
```

The cache model automatically maintains and manages caches. If the cache already exists, then call `updated` updated the data, and automatically remove the latest data from the database when querying the data again. Realization Principle Click here (todo) Learn more
