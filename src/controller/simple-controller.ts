import { Broker, Topic, Partition, ClusterMetadata } from '../types';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class SimpleController {
  private logger: Logger;
  private brokers: Map<string, Broker> = new Map();
  private topics: Map<string, Topic> = new Map();
  private partitions: Map<string, Partition[]> = new Map();
  private controllerId: string;

  constructor() {
    this.logger = new Logger('SimpleController');
    this.controllerId = uuidv4();
  }

  async start() {
    this.startHeartbeatMonitoring();
    this.logger.info(`Simple controller started with ID: ${this.controllerId}`);
  }

  async registerBroker(broker: Broker): Promise<void> {
    this.brokers.set(broker.id, { ...broker, lastHeartbeat: Date.now() });
    this.logger.info(`Registered broker: ${broker.id} at ${broker.host}:${broker.port}`);
  }

  async createTopic(topic: Topic): Promise<void> {
    if (this.topics.has(topic.name)) {
      throw new Error(`Topic ${topic.name} already exists`);
    }

    this.topics.set(topic.name, topic);
    const partitions = this.createPartitions(topic);
    this.partitions.set(topic.name, partitions);

    this.logger.info(`Created topic: ${topic.name} with ${topic.partitions} partitions`);
  }

  private createPartitions(topic: Topic): Partition[] {
    const brokerIds = Array.from(this.brokers.keys());
    if (brokerIds.length === 0) {
      throw new Error('No brokers available for partition assignment');
    }

    const partitions: Partition[] = [];
    
    for (let i = 0; i < topic.partitions; i++) {
      const leaderIndex = i % brokerIds.length;
      const leader = brokerIds[leaderIndex];
      
      const replicas: string[] = [];
      for (let j = 0; j < Math.min(topic.replicationFactor, brokerIds.length); j++) {
        const replicaIndex = (leaderIndex + j) % brokerIds.length;
        replicas.push(brokerIds[replicaIndex]);
      }

      partitions.push({
        id: i,
        topic: topic.name,
        leader,
        replicas,
        isr: [...replicas]
      });
    }

    return partitions;
  }

  async getClusterMetadata(): Promise<ClusterMetadata> {
    return {
      brokers: Array.from(this.brokers.values()),
      topics: Object.fromEntries(this.topics),
      partitions: Object.fromEntries(this.partitions)
    };
  }

  async getTopicPartitions(topicName: string): Promise<Partition[]> {
    return this.partitions.get(topicName) || [];
  }

  private startHeartbeatMonitoring() {
    setInterval(async () => {
      const now = Date.now();
      const deadBrokers: string[] = [];

      for (const [brokerId, broker] of this.brokers) {
        if (now - broker.lastHeartbeat > 30000) {
          deadBrokers.push(brokerId);
        }
      }

      for (const brokerId of deadBrokers) {
        await this.handleBrokerFailure(brokerId);
      }
    }, 10000);
  }

  private async handleBrokerFailure(brokerId: string) {
    this.logger.warn(`Detected broker failure: ${brokerId}`);
    this.brokers.delete(brokerId);

    for (const [topicName, partitions] of this.partitions) {
      for (const partition of partitions) {
        if (partition.leader === brokerId) {
          const newLeader = partition.isr.find(replica => replica !== brokerId);
          if (newLeader) {
            partition.leader = newLeader;
            partition.isr = partition.isr.filter(replica => replica !== brokerId);
            this.logger.info(`Elected new leader ${newLeader} for ${topicName}:${partition.id}`);
          }
        }
      }
    }
  }

  async updateBrokerHeartbeat(brokerId: string) {
    const broker = this.brokers.get(brokerId);
    if (broker) {
      broker.lastHeartbeat = Date.now();
    }
  }

  async close() {
    this.logger.info('Simple controller closed');
  }
}