import { Etcd3 } from 'etcd3';
import { Broker, Topic, Partition, ClusterMetadata } from '../types';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class ClusterController {
  private etcd: Etcd3;
  private logger: Logger;
  private brokers: Map<string, Broker> = new Map();
  private topics: Map<string, Topic> = new Map();
  private partitions: Map<string, Partition[]> = new Map();
  private controllerId: string;

  constructor(etcdEndpoints: string[] = ['localhost:2379']) {
    this.etcd = new Etcd3({ hosts: etcdEndpoints });
    this.logger = new Logger('ClusterController');
    this.controllerId = uuidv4();
  }

  async start() {
    try {
      await this.electController();
      await this.loadClusterState();
      this.startHeartbeatMonitoring();
      this.logger.info(`Controller started with ID: ${this.controllerId}`);
    } catch (error) {
      this.logger.error('Failed to start controller:', error);
      throw error;
    }
  }

  private async electController() {
    const lease = this.etcd.lease(30); // 30 second lease
    await lease.put('/controller/leader').value(this.controllerId);
    
    // Renew lease periodically
    setInterval(async () => {
      try {
        await lease.keepaliveOnce();
      } catch (error) {
        this.logger.error('Failed to renew controller lease:', error);
      }
    }, 10000);
  }

  async registerBroker(broker: Broker): Promise<void> {
    this.brokers.set(broker.id, { ...broker, lastHeartbeat: Date.now() });
    await this.etcd.put(`/brokers/${broker.id}`).value(JSON.stringify(broker));
    this.logger.info(`Registered broker: ${broker.id} at ${broker.host}:${broker.port}`);
  }

  async createTopic(topic: Topic): Promise<void> {
    if (this.topics.has(topic.name)) {
      throw new Error(`Topic ${topic.name} already exists`);
    }

    this.topics.set(topic.name, topic);
    const partitions = this.createPartitions(topic);
    this.partitions.set(topic.name, partitions);

    await this.etcd.put(`/topics/${topic.name}`).value(JSON.stringify(topic));
    await this.etcd.put(`/partitions/${topic.name}`).value(JSON.stringify(partitions));

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
      
      // Assign replicas in round-robin fashion
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
        isr: [...replicas] // Initially all replicas are in-sync
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

  private async loadClusterState() {
    try {
      // Load brokers
      const brokerKeys = await this.etcd.getAll().prefix('/brokers/');
      for (const [key, value] of Object.entries(brokerKeys)) {
        const broker: Broker = JSON.parse(value);
        this.brokers.set(broker.id, broker);
      }

      // Load topics
      const topicKeys = await this.etcd.getAll().prefix('/topics/');
      for (const [key, value] of Object.entries(topicKeys)) {
        const topic: Topic = JSON.parse(value);
        this.topics.set(topic.name, topic);
      }

      // Load partitions
      const partitionKeys = await this.etcd.getAll().prefix('/partitions/');
      for (const [key, value] of Object.entries(partitionKeys)) {
        const topicName = key.split('/').pop()!;
        const partitions: Partition[] = JSON.parse(value);
        this.partitions.set(topicName, partitions);
      }

      this.logger.info(`Loaded cluster state: ${this.brokers.size} brokers, ${this.topics.size} topics`);
    } catch (error) {
      this.logger.error('Failed to load cluster state:', error);
    }
  }

  private startHeartbeatMonitoring() {
    setInterval(async () => {
      const now = Date.now();
      const deadBrokers: string[] = [];

      for (const [brokerId, broker] of this.brokers) {
        if (now - broker.lastHeartbeat > 30000) { // 30 second timeout
          deadBrokers.push(brokerId);
        }
      }

      for (const brokerId of deadBrokers) {
        await this.handleBrokerFailure(brokerId);
      }
    }, 10000); // Check every 10 seconds
  }

  private async handleBrokerFailure(brokerId: string) {
    this.logger.warn(`Detected broker failure: ${brokerId}`);
    this.brokers.delete(brokerId);
    await this.etcd.delete()

    // Reassign partitions that were led by the failed broker
    for (const [topicName, partitions] of this.partitions) {
      let updated = false;
      for (const partition of partitions) {
        if (partition.leader === brokerId) {
          // Elect new leader from ISR
          const newLeader = partition.isr.find(replica => replica !== brokerId);
          if (newLeader) {
            partition.leader = newLeader;
            partition.isr = partition.isr.filter(replica => replica !== brokerId);
            updated = true;
            this.logger.info(`Elected new leader ${newLeader} for ${topicName}:${partition.id}`);
          }
        }
      }
      
      if (updated) {
        await this.etcd.put(`/partitions/${topicName}`).value(JSON.stringify(partitions));
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
    this.etcd.close();
    this.logger.info('Controller closed');
  }
}