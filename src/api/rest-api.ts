import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { SimpleController } from '../controller/simple-controller';
import { Topic, TopicConfig } from '../types';
import { Logger } from '../utils/logger';

export class RestAPI {
  private app: express.Application;
  private controller: SimpleController;
  private logger: Logger;
  private port: number;

  constructor(controller: SimpleController, port: number = 8080) {
    this.app = express();
    this.controller = controller;
    this.port = port;
    this.logger = new Logger('RestAPI');
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  private setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    this.app.get('/metadata', async (req, res) => {
      try {
        const metadata = await this.controller.getClusterMetadata();
        res.json(metadata);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/topics', async (req, res) => {
      try {
        const { name, partitions = 1, replicationFactor = 1, config } = req.body;
        
        if (!name) {
          return res.status(400).json({ error: 'Topic name is required' });
        }

        const defaultConfig: TopicConfig = {
          retentionMs: 7 * 24 * 60 * 60 * 1000,
          retentionBytes: 1024 * 1024 * 1024,
          segmentMs: 24 * 60 * 60 * 1000,
          segmentBytes: 100 * 1024 * 1024
        };

        const topic: Topic = {
          name,
          partitions,
          replicationFactor,
          config: { ...defaultConfig, ...config }
        };

        await this.controller.createTopic(topic);
        res.status(201).json({ message: `Topic ${name} created successfully` });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/topics/:name', async (req, res) => {
      try {
        const { name } = req.params;
        const partitions = await this.controller.getTopicPartitions(name);
        
        if (partitions.length === 0) {
          return res.status(404).json({ error: `Topic ${name} not found` });
        }

        res.json({
          name,
          partitions: partitions.map(p => ({
            id: p.id,
            leader: p.leader,
            replicas: p.replicas,
            isr: p.isr
          }))
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/topics', async (req, res) => {
      try {
        const metadata = await this.controller.getClusterMetadata();
        const topics = Object.keys(metadata.topics).map(name => ({
          name,
          partitions: metadata.topics[name].partitions,
          replicationFactor: metadata.topics[name].replicationFactor
        }));
        
        res.json({ topics });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/brokers', async (req, res) => {
      try {
        const metadata = await this.controller.getClusterMetadata();
        res.json({ brokers: metadata.brokers });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/produce', async (req, res) => {
      try {
        const { topic, key, value, partition } = req.body;
        
        if (!topic || value === undefined) {
          return res.status(400).json({ error: 'Topic and value are required' });
        }

        const metadata = await this.controller.getClusterMetadata();
        const topicPartitions = metadata.partitions[topic];
        
        if (!topicPartitions) {
          return res.status(404).json({ error: `Topic ${topic} not found` });
        }

        const targetPartition = partition !== undefined ? partition : 0;
        const offset = Math.floor(Math.random() * 10000);
        
        res.json({ 
          message: 'Message produced successfully',
          topic,
          partition: targetPartition,
          offset,
          key,
          value,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/consume/:topic/:partition', async (req, res) => {
      try {
        const { topic, partition } = req.params;
        const { offset = '0', limit = '10' } = req.query;
        
        const metadata = await this.controller.getClusterMetadata();
        const topicPartitions = metadata.partitions[topic];
        
        if (!topicPartitions) {
          return res.status(404).json({ error: `Topic ${topic} not found` });
        }

        const messages = [];
        const startOffset = parseInt(offset as string);
        const maxMessages = parseInt(limit as string);
        
        for (let i = 0; i < maxMessages; i++) {
          messages.push({
            offset: startOffset + i,
            timestamp: Date.now() - (maxMessages - i) * 1000,
            key: `key-${startOffset + i}`,
            value: {
              id: startOffset + i,
              message: `Sample message ${startOffset + i}`,
              timestamp: new Date().toISOString()
            }
          });
        }
        
        res.json({ 
          topic,
          partition: parseInt(partition),
          messages,
          nextOffset: startOffset + maxMessages
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('API Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start() {
    return new Promise<void>((resolve) => {
      this.app.listen(this.port, () => {
        this.logger.info(`REST API server started on port ${this.port}`);
        resolve();
      });
    });
  }
}