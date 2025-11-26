import { CommitLog } from '../storage/commit-log';
import { SimpleController } from '../controller/simple-controller';
import { Message, ProduceRequest, ConsumeRequest, Broker } from '../types';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import * as WebSocket from 'ws';
import * as http from 'http';

export class MessageBroker {
  private id: string;
  private host: string;
  private port: number;
  private controller: SimpleController;
  private logs: Map<string, CommitLog> = new Map();
  private logger: Logger;
  private server!: http.Server;
  private wsServer!: WebSocket.Server;
  private dataDir: string;

  constructor(host: string, port: number, controller: SimpleController, dataDir: string = './data') {
    this.id = uuidv4();
    this.host = host;
    this.port = port;
    this.controller = controller;
    this.dataDir = dataDir;
    this.logger = new Logger(`Broker-${this.id}`);
  }

  async start() {
    try {
      await this.startWebSocketServer();
      await this.registerWithController();
      this.startHeartbeat();
      this.logger.info(`Broker started on ${this.host}:${this.port}`);
    } catch (error: any) {
      this.logger.error('Failed to start broker:', error);
      throw error;
    }
  }

  private async startWebSocketServer() {
    this.server = http.createServer();
    this.wsServer = new WebSocket.Server({ server: this.server });

    this.wsServer.on('connection', (ws) => {
      this.logger.debug('New client connected');
      
      ws.on('message', async (data) => {
        try {
          const request = JSON.parse(data.toString());
          const response = await this.handleRequest(request);
          ws.send(JSON.stringify(response));
        } catch (error: any) {
          ws.send(JSON.stringify({ error: error.message }));
        }
      });

      ws.on('close', () => {
        this.logger.debug('Client disconnected');
      });
    });

    return new Promise<void>((resolve) => {
      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  private async handleRequest(request: any): Promise<any> {
    switch (request.type) {
      case 'produce':
        return await this.handleProduce(request.data);
      case 'consume':
        return await this.handleConsume(request.data);
      case 'metadata':
        return await this.handleMetadata();
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  }

  private async handleProduce(request: ProduceRequest): Promise<{ offset: number }> {
    const logKey = `${request.topic}-${request.partition || 0}`;
    let log = this.logs.get(logKey);

    if (!log) {
      log = new CommitLog(this.dataDir, request.topic, request.partition || 0);
      this.logs.set(logKey, log);
    }

    const offset = await log.append({
      key: request.key,
      value: request.value,
      headers: request.headers,
      timestamp: Date.now()
    });

    this.logger.debug(`Produced message to ${request.topic}:${request.partition || 0} at offset ${offset}`);
    return { offset };
  }

  private async handleConsume(request: ConsumeRequest): Promise<{ messages: Message[] }> {
    const logKey = `${request.topic}-${request.partition}`;
    const log = this.logs.get(logKey);

    if (!log) {
      return { messages: [] };
    }

    const messages = await log.readRange(request.offset, Math.min(request.maxBytes / 100, 1000));
    this.logger.debug(`Consumed ${messages.length} messages from ${request.topic}:${request.partition}`);
    
    return { messages };
  }

  private async handleMetadata() {
    return await this.controller.getClusterMetadata();
  }

  private async registerWithController() {
    const broker: Broker = {
      id: this.id,
      host: this.host,
      port: this.port,
      isController: false,
      lastHeartbeat: Date.now()
    };

    await this.controller.registerBroker(broker);
  }

  private startHeartbeat() {
    setInterval(async () => {
      try {
        await this.controller.updateBrokerHeartbeat(this.id);
      } catch (error: any) {
        this.logger.error('Failed to send heartbeat:', error);
      }
    }, 5000);
  }

  async createTopicPartition(topic: string, partition: number) {
    const logKey = `${topic}-${partition}`;
    if (!this.logs.has(logKey)) {
      const log = new CommitLog(this.dataDir, topic, partition);
      this.logs.set(logKey, log);
      this.logger.info(`Created partition ${partition} for topic ${topic}`);
    }
  }

  async getPartitionInfo(topic: string, partition: number) {
    const logKey = `${topic}-${partition}`;
    const log = this.logs.get(logKey);
    
    if (!log) {
      return null;
    }

    return {
      highWaterMark: await log.getHighWaterMark(),
      logSize: await log.getLogSize()
    };
  }

  getId(): string {
    return this.id;
  }

  async close() {
    for (const log of this.logs.values()) {
      await log.close();
    }
    
    this.wsServer.close();
    this.server.close();
    this.logger.info('Broker closed');
  }
}