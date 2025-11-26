import { Level } from 'level';
import { Message, LogSegment } from '../types';
import { Logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

export class CommitLog {
  private db: Level;
  private logger: Logger;
  private topic: string;
  private partition: number;
  private baseOffset: number = 0;
  private nextOffset: number = 0;

  constructor(dataDir: string, topic: string, partition: number) {
    this.topic = topic;
    this.partition = partition;
    this.logger = new Logger(`CommitLog-${topic}-${partition}`);
    
    const logPath = path.join(dataDir, topic, `partition-${partition}`);
    this.ensureDirectory(logPath);
    this.db = new Level(logPath);
    this.initialize();
  }

  private ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async initialize() {
    try {
      // Get the highest offset to continue from
      const iterator = this.db.iterator({ reverse: true, limit: 1 });
      for await (const [key] of iterator) {
        this.nextOffset = parseInt(key.toString()) + 1;
        break;
      }
      this.logger.info(`Initialized log, next offset: ${this.nextOffset}`);
    } catch (error: any) {
      this.logger.error('Failed to initialize log:', error);
    }
  }

  async append(message: Omit<Message, 'offset'>): Promise<number> {
    const offset = this.nextOffset++;
    const fullMessage: Message = {
      ...message,
      offset,
      timestamp: message.timestamp || Date.now()
    };

    try {
      await this.db.put(offset.toString(), JSON.stringify(fullMessage));
      this.logger.debug(`Appended message at offset ${offset}`);
      return offset;
    } catch (error: any) {
      this.logger.error(`Failed to append message:`, error);
      throw error;
    }
  }

  async read(offset: number): Promise<Message | null> {
    try {
      const data = await this.db.get(offset.toString());
      return JSON.parse(data);
    } catch (error) {
      if ((error as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  async readRange(startOffset: number, maxMessages: number = 100): Promise<Message[]> {
    const messages: Message[] = [];
    const iterator = this.db.iterator({
      gte: startOffset.toString(),
      limit: maxMessages
    });

    try {
      for await (const [key, value] of iterator) {
        messages.push(JSON.parse(value));
      }
    } catch (error: any) {
      this.logger.error('Failed to read range:', error);
    }

    return messages;
  }

  async getHighWaterMark(): Promise<number> {
    return this.nextOffset - 1;
  }

  async getLogSize(): Promise<number> {
    let count = 0;
    const iterator = this.db.iterator();
    
    try {
      for await (const [key] of iterator) {
        count++;
      }
    } catch (error: any) {
      this.logger.error('Failed to get log size:', error);
    }

    return count;
  }

  async close() {
    await this.db.close();
    this.logger.info('Commit log closed');
  }
}