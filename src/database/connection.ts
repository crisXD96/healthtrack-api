import Database from 'better-sqlite3';
import { config } from '../config';

let instance: Database.Database | null = null;

/**
 * Devuelve la conexión SQLite (singleton).
 * La primera llamada abre el archivo indicado en config.dbPath.
 */
export function getDb(): Database.Database {
  if (!instance) {
    instance = new Database(config.dbPath);
    if (config.dbPath !== ':memory:') {
      instance.pragma('journal_mode = WAL');
    }
    instance.pragma('foreign_keys = ON');
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
