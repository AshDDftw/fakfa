import { MessageConsumer } from '../consumer/message-consumer';
import { PartitionAssignment, OffsetCommit } from '../types';

describe('MessageConsumer', () => {
  let consumer: MessageConsumer;

  beforeEach(() => {
    consumer = new MessageConsumer('test-group', 'test-consumer');
  });

  afterEach(async () => {
    await consumer.close();
  });

  test('should create consumer with generated ID if not provided', () => {
    const consumer2 = new MessageConsumer('test-group');
    expect((consumer2 as any).consumerId).toMatch(/^consumer-\d+-[a-z0-9]+$/);
  });

  test('should create consumer with provided ID', () => {
    const consumer2 = new MessageConsumer('test-group', 'my-consumer');
    expect((consumer2 as any).consumerId).toBe('my-consumer');
  });

  test('should initialize with empty assignments', () => {
    const assignments = consumer.getAssignments();
    expect(assignments).toHaveLength(0);
  });

  test('should commit offsets correctly', async () => {
    // Mock some assignments
    (consumer as any).assignments = [
      { topic: 'topic1', partition: 0, offset: 10 },
      { topic: 'topic1', partition: 1, offset: 20 },
      { topic: 'topic2', partition: 0, offset: 5 }
    ];

    await consumer.commitOffsets();
    
    // Check that offsets were stored internally
    const offsets = (consumer as any).offsets;
    expect(offsets.get('topic1-0')).toBe(10);
    expect(offsets.get('topic1-1')).toBe(20);
    expect(offsets.get('topic2-0')).toBe(5);
  });

  test('should commit specific offsets', async () => {
    const commits: OffsetCommit[] = [
      { topic: 'topic1', partition: 0, offset: 100 },
      { topic: 'topic2', partition: 1, offset: 200 }
    ];

    await consumer.commitOffsets(commits);
    
    const offsets = (consumer as any).offsets;
    expect(offsets.get('topic1-0')).toBe(100);
    expect(offsets.get('topic2-1')).toBe(200);
  });

  test('should return copy of assignments', () => {
    const mockAssignments: PartitionAssignment[] = [
      { topic: 'topic1', partition: 0, offset: 0 },
      { topic: 'topic1', partition: 1, offset: 0 }
    ];
    
    (consumer as any).assignments = mockAssignments;
    
    const assignments = consumer.getAssignments();
    expect(assignments).toEqual(mockAssignments);
    expect(assignments).not.toBe(mockAssignments); // Should be a copy
  });

  test('should handle empty poll when no metadata', async () => {
    const messages = await consumer.poll(100);
    expect(messages).toHaveLength(0);
  });

  test('should handle subscribe without metadata', async () => {
    await expect(consumer.subscribe(['test-topic'])).rejects.toThrow('No cluster metadata available');
  });
});