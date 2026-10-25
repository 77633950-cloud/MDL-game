import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

try {
  process.loadEnvFile(path.join(here, '..', '.env'))
} catch {
  // 没有 .env 时继续用系统环境变量
}
