import { MessageProducer } from '../producer/message-producer';

describe('MessageProducer', () => {
  test('should use round-robin strategy by default', () => {
    const producer = new MessageProducer();
    
    // Test multiple calls to see distribution
    const results = [];
    for (let i = 0; i < 10; i++) {
      const partition = (producer as any).partitionStrategy(undefined, 3);
      results.push(partition);
    }
    
    // Should return valid partition numbers
    results.forEach(partition => {
      expect(partition).toBeGreaterThanOrEqual(0);
      expect(partition).toBeLessThan(3);
    });
  });

  test('should use key-hash strategy correctly', () => {
    const strategy = MessageProducer.keyHashStrategy;
    
    // Same key should always return same partition
    const partition1 = strategy('user-123', 5);
    const partition2 = strategy('user-123', 5);
    expect(partition1).toBe(partition2);
    
    // Different keys should potentially return different partitions
    const partition3 = strategy('user-456', 5);
    expect(partition3).toBeGreaterThanOrEqual(0);
    expect(partition3).toBeLessThan(5);
    
    // Null key should return 0
    const partition4 = strategy(undefined, 5);
    expect(partition4).toBe(0);
  });

  test('should handle partition count correctly', () => {
    const strategy = MessageProducer.keyHashStrategy;
    
    // Test with different partition counts
    const partition1 = strategy('test-key', 1);
    expect(partition1).toBe(0);
    
    const partition2 = strategy('test-key', 10);
    expect(partition2).toBeGreaterThanOrEqual(0);
    expect(partition2).toBeLessThan(10);
  });

  test('should create producer with custom strategy', () => {
    const customStrategy = (key: string | undefined, partitionCount: number) => {
      return key ? key.length % partitionCount : 0;
    };
    
    const producer = new MessageProducer(customStrategy);
    expect(producer).toBeInstanceOf(MessageProducer);
  });
});