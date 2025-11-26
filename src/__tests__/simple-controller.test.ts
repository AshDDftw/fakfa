import { SimpleController } from '../controller/simple-controller';
import { Broker, Topic } from '../types';

describe('SimpleController', () => {
  let controller: SimpleController;

  beforeEach(() => {
    controller = new SimpleController();
  });

  afterEach(async () => {
    await controller.close();
  });

  test('should register broker successfully', async () => {
    const broker: Broker = {
      id: 'broker-1',
      host: 'localhost',
      port: 9092,
      isController: false,
      lastHeartbeat: Date.now()
    };

    await controller.registerBroker(broker);
    
    const metadata = await controller.getClusterMetadata();
    expect(metadata.brokers).toHaveLength(1);
    expect(metadata.brokers[0].id).toBe('broker-1');
  });

  test('should create topic with partitions', async () => {
    // Register a broker first
    const broker: Broker = {
      id: 'broker-1',
      host: 'localhost',
      port: 9092,
      isController: false,
      lastHeartbeat: Date.now()
    };
    await controller.registerBroker(broker);

    const topic: Topic = {
      name: 'test-topic',
      partitions: 3,
      replicationFactor: 1,
      config: {
        retentionMs: 86400000,
        retentionBytes: 1073741824,
        segmentMs: 3600000,
        segmentBytes: 104857600
      }
    };

    await controller.createTopic(topic);
    
    const partitions = await controller.getTopicPartitions('test-topic');
    expect(partitions).toHaveLength(3);
    expect(partitions[0].topic).toBe('test-topic');
    expect(partitions[0].leader).toBe('broker-1');
  });

  test('should throw error when creating duplicate topic', async () => {
    const broker: Broker = {
      id: 'broker-1',
      host: 'localhost',
      port: 9092,
      isController: false,
      lastHeartbeat: Date.now()
    };
    await controller.registerBroker(broker);

    const topic: Topic = {
      name: 'test-topic',
      partitions: 1,
      replicationFactor: 1,
      config: {
        retentionMs: 86400000,
        retentionBytes: 1073741824,
        segmentMs: 3600000,
        segmentBytes: 104857600
      }
    };

    await controller.createTopic(topic);
    
    await expect(controller.createTopic(topic)).rejects.toThrow('Topic test-topic already exists');
  });

  test('should distribute partitions across multiple brokers', async () => {
    // Register multiple brokers
    const brokers: Broker[] = [
      { id: 'broker-1', host: 'localhost', port: 9092, isController: false, lastHeartbeat: Date.now() },
      { id: 'broker-2', host: 'localhost', port: 9093, isController: false, lastHeartbeat: Date.now() },
      { id: 'broker-3', host: 'localhost', port: 9094, isController: false, lastHeartbeat: Date.now() }
    ];

    for (const broker of brokers) {
      await controller.registerBroker(broker);
    }

    const topic: Topic = {
      name: 'distributed-topic',
      partitions: 6,
      replicationFactor: 2,
      config: {
        retentionMs: 86400000,
        retentionBytes: 1073741824,
        segmentMs: 3600000,
        segmentBytes: 104857600
      }
    };

    await controller.createTopic(topic);
    
    const partitions = await controller.getTopicPartitions('distributed-topic');
    expect(partitions).toHaveLength(6);
    
    // Check that partitions are distributed across brokers
    const leaders = partitions.map(p => p.leader);
    const uniqueLeaders = new Set(leaders);
    expect(uniqueLeaders.size).toBe(3); // All 3 brokers should be leaders
    
    // Check replication
    expect(partitions[0].replicas).toHaveLength(2);
    expect(partitions[0].isr).toHaveLength(2);
  });

  test('should update broker heartbeat', async () => {
    const broker: Broker = {
      id: 'broker-1',
      host: 'localhost',
      port: 9092,
      isController: false,
      lastHeartbeat: Date.now() - 10000 // 10 seconds ago
    };

    await controller.registerBroker(broker);
    
    const beforeUpdate = Date.now();
    await controller.updateBrokerHeartbeat('broker-1');
    
    const metadata = await controller.getClusterMetadata();
    expect(metadata.brokers[0].lastHeartbeat).toBeGreaterThanOrEqual(beforeUpdate);
  });

  test('should return empty partitions for non-existent topic', async () => {
    const partitions = await controller.getTopicPartitions('non-existent');
    expect(partitions).toHaveLength(0);
  });
});