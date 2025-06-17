import { RedisBin, RedisCache } from 'blue-fish-redis'

export default new (class {
  public bin = new RedisBin({
    host: '127.0.0.1',
    port: 6379,
    password: '',
    db: 1,
    prefix: '',
    trace: false,
  })

  public cache = new RedisCache(this.bin)
})()
