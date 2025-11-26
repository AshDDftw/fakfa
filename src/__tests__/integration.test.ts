import { SimpleController } from '../controller/simple-controller';
import { MessageBroker } from '../broker/message-broker';
import { MessageProducer } from '../producer/message-producer';
import { MessageConsumer } from '../consumer/message-consumer';
import { Topic, Broker } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('Integration Tests', () => {
  let controller: SimpleController;
  let broker: MessageBroker;
  const testDataDir = path.join(__dirname, '../../test-integration-data');

  beforeAll(async () => {
    // Clean up test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (broker) await broker.close();
    if (controller) await controller.close();
    
    // Clean up test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  test('should create complete broker-controller setup', async () => {
    // Start controller
    controller = new SimpleController();
    await controller.start();

    // Start broker
    broker = new MessageBroker('localhost', 9999, controller, testDataDir);
    await broker.start();

    // Wait a bit for registration
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify broker is registered
    const metadata = await controller.getClusterMetadata();
    expect(metadata.brokers).toHaveLength(1);
    expect(metadata.brokers[0].host).toBe('localhost');
    expect(metadata.brokers[0].port).toBe(9999);
  });

  test('should create topic and partitions', async () => {
    const topic: Topic = {
      name: 'integration-test-topic',
      partitions: 2,
      replicationFactor: 1,
      config: {
        retentionMs: 86400000,
        retentionBytes: 1073741824,
        segmentMs: 3600000,
        segmentBytes: 104857600
      }
    };

    await controller.createTopic(topic);

    const partitions = await controller.getTopicPartitions('integration-test-topic');
    expect(partitions).toHaveLength(2);
    expect(partitions[0].topic).toBe('integration-test-topic');
    expect(partitions[1].topic).toBe('integration-test-topic');
  });

  test('should handle broker heartbeat updates', async () => {
    const brokerId = broker.getId();
    const beforeUpdate = Date.now();
    
    await controller.updateBrokerHeartbeat(brokerId);
    
    const metadata = await controller.getClusterMetadata();
    const brokerInfo = metadata.brokers.find(b => b.id === brokerId);
    
    expect(brokerInfo).toBeTruthy();
    expect(brokerInfo!.lastHeartbeat).toBeGreaterThanOrEqual(beforeUpdate);
  });

  test('should create partition logs when topic is created', async () => {
    const topic: Topic = {
      name: 'partition-test-topic',
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

    // Create partition logs on broker
    await broker.createTopicPartition('partition-test-topic', 0);
    await broker.createTopicPartition('partition-test-topic', 1);
    await broker.createTopicPartition('partition-test-topic', 2);

    // Verify partition info
    const partition0Info = await broker.getPartitionInfo('partition-test-topic', 0);
    const partition1Info = await broker.getPartitionInfo('partition-test-topic', 1);
    const partition2Info = await broker.getPartitionInfo('partition-test-topic', 2);

    expect(partition0Info).toBeTruthy();
    expect(partition1Info).toBeTruthy();
    expect(partition2Info).toBeTruthy();
    
    expect(partition0Info!.highWaterMark).toBe(-1); // No messages yet
    expect(partition0Info!.logSize).toBe(0);
  });

  test('should handle multiple brokers registration', async () => {
    // Register additional mock brokers
    const broker2: Broker = {
      id: 'broker-2',
      host: 'localhost',
      port: 9998,
      isController: false,
      lastHeartbeat: Date.now()
    };

    const broker3: Broker = {
      id: 'broker-3',
      host: 'localhost',
      port: 9997,
      isController: false,
      lastHeartbeat: Date.now()
    };

    await controller.registerBroker(broker2);
    await controller.registerBroker(broker3);

    const metadata = await controller.getClusterMetadata();
    expect(metadata.brokers).toHaveLength(3); // Original + 2 new ones
    
    const brokerIds = metadata.brokers.map(b => b.id);
    expect(brokerIds).toContain('broker-2');
    expect(brokerIds).toContain('broker-3');
  });

  test('should distribute partitions across multiple brokers', async () => {
    const topic: Topic = {
      name: 'distributed-topic',
      partitions: 6,
      replicationFactor: 1,
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
    
    // Check that partitions are distributed across available brokers
    const leaders = partitions.map(p => p.leader);
    const uniqueLeaders = new Set(leaders);
    expect(uniqueLeaders.size).toBeGreaterThan(1); // Should use multiple brokers
  });
});