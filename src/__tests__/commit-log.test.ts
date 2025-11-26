import { CommitLog } from '../storage/commit-log';
import * as fs from 'fs';
import * as path from 'path';

describe('CommitLog', () => {
  const testDir = path.join(__dirname, '../../test-data');
  let commitLog: CommitLog;

  beforeEach(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    
    commitLog = new CommitLog(testDir, 'test-topic', 0);
  });

  afterEach(async () => {
    await commitLog.close();
    
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('should append and read messages', async () => {
    const message = {
      key: 'test-key',
      value: { data: 'test-value' },
      timestamp: Date.now()
    };

    const offset = await commitLog.append(message);
    expect(offset).toBe(0);

    const readMessage = await commitLog.read(offset);
    expect(readMessage).toMatchObject({
      ...message,
      offset
    });
  });

  test('should read message range', async () => {
    const messages = [
      { key: 'key1', value: 'value1', timestamp: Date.now() },
      { key: 'key2', value: 'value2', timestamp: Date.now() },
      { key: 'key3', value: 'value3', timestamp: Date.now() }
    ];

    for (const message of messages) {
      await commitLog.append(message);
    }

    const readMessages = await commitLog.readRange(0, 2);
    expect(readMessages).toHaveLength(2);
    expect(readMessages[0].offset).toBe(0);
    expect(readMessages[1].offset).toBe(1);
  });

  test('should return null for non-existent offset', async () => {
    const message = await commitLog.read(999);
    expect(message).toBeNull();
  });

  test('should track high water mark', async () => {
    await commitLog.append({ value: 'test1', timestamp: Date.now() });
    await commitLog.append({ value: 'test2', timestamp: Date.now() });

    const highWaterMark = await commitLog.getHighWaterMark();
    expect(highWaterMark).toBe(1);
  });
});