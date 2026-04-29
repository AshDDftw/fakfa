# Project Overview: Fakfa

## Introduction

**Fakfa** is a TypeScript-based project that simulates a distributed message broker system, inspired by Apache Kafka. It provides a modular architecture for message production, consumption, and broker management, with REST API support and a simple dashboard for monitoring.

---

## Architecture

- **src/**: Main source code
  - **api/**: REST API endpoints (e.g., `rest-api.ts`)
  - **broker/**: Core message broker logic (e.g., `message-broker.ts`)
  - **consumer/**: Message consumer logic
  - **controller/**: Cluster and controller logic (e.g., `cluster-controller.ts`, `simple-controller.ts`)
  - **core/**: Core utilities and types
  - **dashboard/**: Simple HTML dashboard for monitoring
  - **examples/**: Example producer/consumer scripts
  - **producer/**: Message producer logic
  - **scripts/**: Startup scripts for broker and controller
  - **storage/**: Commit log implementation
  - **types/**: Type definitions
  - **utils/**: Utility functions (e.g., logging)

---

## Key Components & Detailed Code Explanations

### 1. Message Broker (`src/broker/message-broker.ts`)

The **MessageBroker** is the core component that handles message storage, routing, and WebSocket communication with producers and consumers.

**Key Responsibilities:**
- Manages WebSocket connections from clients (producers/consumers)
- Stores messages in commit logs organized by topic and partition
- Handles metadata requests from producers and consumers
- Maintains heartbeat with controller and auto-registers as a broker
- Routes requests to appropriate handlers

**Core Code:**
```typescript
export class MessageBroker {
  private id: string;                          // Unique broker ID
  private logs: Map<string, CommitLog>;        // Commit logs per partition
  private wsServer: WebSocket.Server;          // WebSocket server for clients

  async start() {
    await this.startWebSocketServer();
    await this.registerWithController();       // Register with cluster controller
    this.startHeartbeat();                     // Send periodic heartbeats
  }

  private async handleRequest(request: any): Promise<any> {
    switch (request.type) {
      case 'produce':  return await this.handleProduce(request.data);
      case 'consume':  return await this.handleConsume(request.data);
      case 'metadata': return await this.handleMetadata();
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
    
    return { offset };  // Returns the offset where message was stored
  }
}
```

---

### 2. Commit Log (`src/storage/commit-log.ts`)

The **CommitLog** implements an append-only log using LevelDB for durable message storage. It ensures messages can be read from specific offsets and recovered after broker restarts.

**Key Responsibilities:**
- Append messages with automatic offset assignment
- Retrieve single messages or ranges by offset
- Persist data to disk using LevelDB
- Track next available offset on startup

**Core Code:**
```typescript
export class CommitLog {
  private db: Level;                   // LevelDB instance for persistence
  private nextOffset: number = 0;      // Next offset to assign

  async append(message: Omit<Message, 'offset'>): Promise<number> {
    const offset = this.nextOffset++;  // Auto-increment offset
    const fullMessage: Message = {
      ...message,
      offset,
      timestamp: message.timestamp || Date.now()
    };

    await this.db.put(offset.toString(), JSON.stringify(fullMessage));
    return offset;  // Return assigned offset to producer
  }

  async readRange(startOffset: number, maxMessages: number = 100): Promise<Message[]> {
    const messages: Message[] = [];
    const iterator = this.db.iterator({
      gte: startOffset.toString(),
      limit: maxMessages
    });
    
    for await (const [key, value] of iterator) {
      messages.push(JSON.parse(value));
    }
    
    return messages;  // Return batch of messages to consumer
  }
}
```

---

### 3. Message Producer (`src/producer/message-producer.ts`)

The **MessageProducer** connects to brokers and sends messages with support for different partitioning strategies.

**Key Responsibilities:**
- Establish WebSocket connections to multiple brokers
- Fetch cluster metadata to determine target brokers and leaders
- Support pluggable partition strategies (round-robin, key-based hashing)
- Send produce requests and wait for acknowledgments

**Core Code:**
```typescript
export class MessageProducer {
  private connections: Map<string, WebSocket>;     // Connection pool to brokers
  private metadata: ClusterMetadata | null = null; // Cluster topology
  private partitionStrategy: PartitionStrategy;    // Partition selection logic

  async connect(brokerEndpoints: string[]) {
    // Connect to all brokers in the cluster
    for (const endpoint of brokerEndpoints) {
      const ws = new WebSocket(`ws://${endpoint}`);
      await this.waitForConnection(ws);
      this.connections.set(endpoint, ws);
    }

    await this.fetchMetadata();  // Get broker and topic information
  }

  async produce(request: ProduceRequest): Promise<{ offset: number }> {
    // Determine which partition to send message to
    const partition = request.partition !== undefined 
      ? request.partition 
      : this.partitionStrategy(request.key, topicPartitions.length);

    // Find leader broker for the target partition
    const leaderBroker = this.metadata.brokers.find(b => b.id === targetPartition.leader);
    
    // Send message to leader broker
    return this.sendProduceRequest(ws, { ...request, partition });
  }

  static keyHashStrategy: PartitionStrategy = (key, partitionCount) => {
    // Hash-based partitioning: same key always goes to same partition
    if (!key) return 0;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % partitionCount;
  };
}
```

---

### 4. Message Consumer (`src/consumer/message-consumer.ts`)

The **MessageConsumer** subscribes to topics and polls for messages from assigned partitions.

**Key Responsibilities:**
- Connect to brokers and fetch cluster metadata
- Subscribe to topics and receive partition assignments
- Poll for messages from assigned partitions
- Track consumed offsets and support offset commits

**Core Code:**
```typescript
export class MessageConsumer {
  private groupId: string;                        // Consumer group identifier
  private assignments: PartitionAssignment[] = []; // Assigned partitions
  private offsets: Map<string, number>;          // Track offset per partition

  async subscribe(topics: string[]) {
    // Get partition info from metadata
    for (const topic of topics) {
      const topicPartitions = this.metadata.partitions[topic];
      
      // Assign all partitions to this consumer
      for (const partition of topicPartitions) {
        this.assignments.push({
          topic,
          partition: partition.id,
          offset: this.offsets.get(`${topic}-${partition.id}`) || 0
        });
      }
    }
  }

  async poll(timeoutMs: number = 1000): Promise<Message[]> {
    const messages: Message[] = [];
    
    // Fetch messages from all assigned partitions in parallel
    const pollPromises = this.assignments.map(assignment =>
      this.pollPartition(assignment, timeoutMs)
    );

    const results = await Promise.allSettled(pollPromises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        messages.push(...result.value);
      }
    }

    return messages;  // Return all fetched messages
  }
}
```

---

### 5. Simple Controller (`src/controller/simple-controller.ts`)

The **SimpleController** manages the cluster state, including broker registration, topic creation, and partition assignment.

**Key Responsibilities:**
- Register brokers and monitor their heartbeats
- Create topics and assign partitions to brokers
- Store and distribute cluster metadata
- Detect broker failures and handle rebalancing
- Serve metadata requests from producers/consumers

**Core Code:**
```typescript
export class SimpleController {
  private brokers: Map<string, Broker>;      // Active brokers in cluster
  private topics: Map<string, Topic>;        // Topic definitions
  private partitions: Map<string, Partition[]>; // Partition assignments

  async registerBroker(broker: Broker): Promise<void> {
    this.brokers.set(broker.id, { ...broker, lastHeartbeat: Date.now() });
  }

  async createTopic(topic: Topic): Promise<void> {
    const partitions = this.createPartitions(topic);
    
    // Round-robin partition assignment: spread partitions across brokers
    for (let i = 0; i < topic.partitions; i++) {
      const leaderIndex = i % brokerIds.length;
      partitions.push({
        id: i,
        topic: topic.name,
        leader: brokerIds[leaderIndex],  // Assign leader
        replicas: [...],                  // Assign replicas
        isr: [...]                        // In-Sync Replicas
      });
    }
  }

  async getClusterMetadata(): Promise<ClusterMetadata> {
    return {
      brokers: Array.from(this.brokers.values()),
      topics: Object.fromEntries(this.topics),
      partitions: Object.fromEntries(this.partitions)
    };
  }

  private startHeartbeatMonitoring() {
    setInterval(() => {
      for (const [brokerId, broker] of this.brokers) {
        // Remove broker if no heartbeat for 30 seconds
        if (Date.now() - broker.lastHeartbeat > 30000) {
          this.handleBrokerFailure(brokerId);
        }
      }
    }, 10000);
  }
}
```

---

### 6. REST API (`src/api/rest-api.ts`)

The **RestAPI** exposes HTTP endpoints for cluster management and monitoring.

**Key Responsibilities:**
- Provide endpoints for topic creation and querying
- Expose cluster metadata and broker information
- Enable manual message production via HTTP
- Serve the dashboard and health checks

**Core Code:**
```typescript
export class RestAPI {
  private app: express.Application;
  
  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // Get cluster metadata
    this.app.get('/metadata', async (req, res) => {
      const metadata = await this.controller.getClusterMetadata();
      res.json(metadata);
    });

    // Create a new topic
    this.app.post('/topics', async (req, res) => {
      const { name, partitions = 1, replicationFactor = 1, config } = req.body;
      
      const topic: Topic = {
        name,
        partitions,
        replicationFactor,
        config: { ...defaultConfig, ...config }
      };

      await this.controller.createTopic(topic);
      res.status(201).json({ message: `Topic ${name} created successfully` });
    });

    // Get topic information
    this.app.get('/topics/:name', async (req, res) => {
      const partitions = await this.controller.getTopicPartitions(req.params.name);
      res.json({
        name: req.params.name,
        partitions: partitions.map(p => ({
          id: p.id,
          leader: p.leader,
          replicas: p.replicas,
          isr: p.isr
        }))
      });
    });

    // List all brokers
    this.app.get('/brokers', async (req, res) => {
      const metadata = await this.controller.getClusterMetadata();
      res.json({ brokers: metadata.brokers });
    });

    // Produce message via HTTP
    this.app.post('/produce', async (req, res) => {
      const { topic, key, value } = req.body;
      // Route to appropriate broker and return offset
    });
  }
}
```

---

### 7. Type Definitions (`src/types/index.ts`)

Defines all TypeScript interfaces used throughout the project.

**Key Types:**
```typescript
export interface Message {
  offset: number;               // Position in commit log
  timestamp: number;            // When message was created
  key?: string;                 // Partitioning key
  value: any;                   // Message payload
  headers?: Record<string, string>; // Optional metadata
}

export interface Partition {
  id: number;
  topic: string;
  leader: string;               // Leader broker ID
  replicas: string[];           // Replica broker IDs
  isr: string[];                // In-Sync Replicas
}

export interface Topic {
  name: string;
  partitions: number;           // Number of partitions
  replicationFactor: number;    // Replication factor
  config: TopicConfig;          // Retention and segment settings
}

export interface Broker {
  id: string;
  host: string;
  port: number;
  isController: boolean;
  lastHeartbeat: number;        // Last heartbeat timestamp
}

export interface ProduceRequest {
  topic: string;
  partition?: number;           // Optional, auto-selected if omitted
  key?: string;
  value: any;
  headers?: Record<string, string>;
}

export interface ConsumeRequest {
  topic: string;
  partition: number;
  offset: number;               // Starting offset
  maxBytes: number;             // Max bytes to fetch
}

export type PartitionStrategy = 
  (key: string | undefined, partitionCount: number) => number;
```

---

### 8. Logger Utility (`src/utils/logger.ts`)

Simple logging utility for structured output across all components.

**Features:**
- Timestamps on all log messages
- Log level indicators (INFO, ERROR, WARN, DEBUG)
- Component identification for easy tracing
- Console output with colors (via console methods)

**Code:**
```typescript
export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  info(message: string, ...args: any[]) {
    console.log(`[${new Date().toISOString()}] [INFO] [${this.component}] ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(`[${new Date().toISOString()}] [ERROR] [${this.component}] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]) {
    console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.component}] ${message}`, ...args);
  }
}
```

---

### 9. Example: Producer (`src/examples/producer.ts`)

Demonstrates how to use the **MessageProducer** to send messages.

**Workflow:**
```typescript
async function runProducer() {
  // Create producer with key-based partitioning strategy
  const producer = new MessageProducer(MessageProducer.keyHashStrategy);
  
  // Connect to multiple brokers
  await producer.connect(['localhost:9092', 'localhost:9093']);

  // Send 100 test messages
  for (let i = 0; i < 100; i++) {
    const key = `user-${i % 10}`;  // Same keys go to same partition
    const value = {
      id: i,
      message: `Hello from producer! Message ${i}`,
      timestamp: new Date().toISOString(),
      user: key
    };

    // Send message and get offset
    const result = await producer.produce({
      topic: 'test-topic',
      key,
      value
    });
    
    console.log(`Sent message ${i} to offset ${result.offset}`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
  }

  await producer.close();
}
```

---

### 10. Example: Consumer (`src/examples/consumer.ts`)

Demonstrates how to use the **MessageConsumer** to receive messages.

**Workflow:**
```typescript
async function runConsumer() {
  // Create consumer in a group
  const consumer = new MessageConsumer('test-group', 'consumer-1');
  
  // Connect to brokers
  await consumer.connect(['localhost:9092', 'localhost:9093']);
  
  // Subscribe to topic
  await consumer.subscribe(['test-topic']);

  // Poll for messages in a loop
  let messageCount = 0;
  while (messageCount < 50) {
    // Fetch messages with 5 second timeout
    const messages = await consumer.poll(5000);
    
    for (const message of messages) {
      messageCount++;
      console.log(`Received message: ${JSON.stringify(message.value)} at offset ${message.offset}`);
    }

    // Commit offsets after processing
    if (messages.length > 0) {
      await consumer.commitOffsets();
    }
  }

  await consumer.close();
}
```

---

## Project Structure Overview

```
src/
├── index.ts                 # Main entry point
├── api/
│   └── rest-api.ts         # Express.js REST API server (HTTP endpoints)
├── broker/
│   └── message-broker.ts   # WebSocket broker server (handles messages, partition storage)
├── consumer/
│   └── message-consumer.ts # Consumer client (subscribes & polls messages)
├── controller/
│   ├── simple-controller.ts     # Cluster state management & broker coordination
│   └── cluster-controller.ts    # (Alternative controller implementation)
├── producer/
│   └── message-producer.ts # Producer client (sends messages with partitioning)
├── storage/
│   └── commit-log.ts       # Append-only log (LevelDB persistence)
├── types/
│   └── index.ts            # TypeScript interfaces & types
├── utils/
│   └── logger.ts           # Logging utility
├── scripts/
│   ├── start-broker.ts     # Script to start broker instance
│   └── start-controller.ts # Script to start controller instance
├── examples/
│   ├── producer.ts         # Example producer usage
│   └── consumer.ts         # Example consumer usage
├── dashboard/
│   └── index.html          # Web UI for monitoring
└── __tests__/
    ├── integration.test.ts
    ├── message-broker.test.ts
    ├── message-consumer.test.ts
    ├── message-producer.test.ts
    ├── simple-controller.test.ts
    └── logger.test.ts
```

---

## Testing

The project uses **Jest** for unit and integration testing. All test files are located in `src/__tests__/`.

### Available Tests:

- **`message-broker.test.ts`** - Tests WebSocket server, message produce/consume, metadata handling
- **`message-producer.test.ts`** - Tests producer connections, partitioning strategies, message sending
- **`message-consumer.test.ts`** - Tests consumer subscriptions, polling, offset tracking
- **`simple-controller.test.ts`** - Tests broker registration, topic creation, partition assignment
- **`logger.test.ts`** - Tests logging output formatting
- **`integration.test.ts`** - End-to-end tests with full cluster setup

### Run Tests:
```sh
npm test                    # Run all tests
npm test -- --watch        # Run tests in watch mode
npm test -- --coverage     # Generate coverage report
```

---

## Running the Project

### 1. Install Dependencies
```sh
npm install
```

This installs:
- `express` - HTTP framework for REST API
- `ws` - WebSocket library for broker-client communication
- `level` - LevelDB wrapper for persistent storage
- `jest` - Testing framework
- `typescript` - TypeScript compiler

### 2. Start Cluster Components

**Start Controller** (Cluster coordinator):
```sh
npm run start:controller
```
Output: `Simple controller started with ID: <uuid>`

**Start Broker** (Message storage & routing):
```sh
npm run start:broker
```
Output: `Broker started on localhost:9092`

**Start API Server** (HTTP management interface):
```sh
npm run start:api
```
Output: `REST API listening on port 8080`

### 3. Run Examples

**Run Producer** (Send 100 messages):
```sh
npm run example:producer
```
Output:
```
[timestamp] [INFO] [ProducerExample] Producer connected, starting to send messages...
[timestamp] [INFO] [ProducerExample] Sent message 0 to offset 0
[timestamp] [INFO] [ProducerExample] Sent message 1 to offset 1
...
```

**Run Consumer** (Receive and process messages):
```sh
npm run example:consumer
```
Output:
```
[timestamp] [INFO] [ConsumerExample] Consumer started, polling for messages...
[timestamp] [INFO] [ConsumerExample] Received message 1: {id: 0, message: "Hello from producer! Message 0", ...} (offset: 0)
...
```

### 4. Interact via REST API

Once API server is running, you can interact with the cluster:

**Health Check:**
```bash
curl http://localhost:8080/health
# Response: {"status":"healthy","timestamp":"2024-01-09T..."}
```

**Get Cluster Metadata:**
```bash
curl http://localhost:8080/metadata
# Response: {brokers: [...], topics: {...}, partitions: {...}}
```

**Create a Topic:**
```bash
curl -X POST http://localhost:8080/topics \
  -H "Content-Type: application/json" \
  -d '{
    "name": "events",
    "partitions": 3,
    "replicationFactor": 2,
    "config": {"retentionMs": 86400000}
  }'
# Response: {"message":"Topic events created successfully"}
```

**Get Topic Info:**
```bash
curl http://localhost:8080/topics/events
# Response: {name: "events", partitions: [{id: 0, leader: "broker-1", ...}, ...]}
```

**List All Topics:**
```bash
curl http://localhost:8080/topics
# Response: {topics: [{name: "test-topic", partitions: 1, ...}, ...]}
```

**List All Brokers:**
```bash
curl http://localhost:8080/brokers
# Response: {brokers: [{id: "uuid", host: "localhost", port: 9092, ...}, ...]}
```

**Produce Message:**
```bash
curl -X POST http://localhost:8080/produce \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "events",
    "key": "user-123",
    "value": {"event": "login", "timestamp": "2024-01-09T..."}
  }'
# Response: {offset: 5}
```

---

## Message Flow Diagram

```
PRODUCER
    │
    └─> Connect to Brokers (WebSocket)
        │
        ├─> Fetch Metadata (broker list, topic partitions, leaders)
        │
        └─> Produce Message
            ├─> Determine target partition (using partitionStrategy)
            ├─> Find partition leader (from metadata)
            └─> Send to leader broker
                │
                └─> BROKER
                    ├─> Receive message on WebSocket
                    ├─> Get/Create CommitLog for topic-partition
                    └─> Append message to log (LevelDB)
                        ├─> Assign offset
                        ├─> Persist to disk
                        └─> Return offset to producer

CONSUMER
    │
    └─> Connect to Brokers (WebSocket)
        │
        ├─> Fetch Metadata
        │
        └─> Subscribe to Topics
            ├─> Get assigned partitions from metadata
            └─> Initialize offset tracking per partition
                │
                └─> Poll for Messages (in loop)
                    ├─> For each assigned partition:
                    │   ├─> Request from broker (offset, maxBytes)
                    │   └─> Broker reads from CommitLog
                    │       └─> Return message batch
                    ├─> Merge results from all partitions
                    ├─> Process messages
                    └─> Commit offsets
                        └─> Track consumed position per partition
```

---

## Deployment & Persistence

### Data Storage
- **Broker Partitions:** Stored in `./data/{topic}/partition-{id}/` directories
- **Storage Backend:** LevelDB (key-value store)
- **Persistence:** Messages survive broker restarts

### Cluster State
- **Controller Memory:** Broker registrations, topic metadata, partition assignments
- **Heartbeat Monitoring:** Brokers send heartbeats every 5 seconds
- **Failure Detection:** Brokers removed after 30 seconds without heartbeat

### Scalability Considerations
- **Horizontal:** Add more brokers, create more partitions, distribute across machines
- **Vertical:** Increase partition count, increase replication factor
- **Performance:** WebSocket reduces latency vs HTTP; LevelDB provides fast disk I/O

---

## Notable Features

- **Modular Architecture** - Separate concerns for producer, consumer, broker, controller
- **Partitioning Strategies** - Pluggable strategies (round-robin, key-hash) for message distribution
- **Commit Log** - Append-only log with offset-based reading for message durability
- **Cluster Management** - Controller tracks brokers, detects failures, manages metadata
- **Leader Election** - Partition leaders handle produce/consume requests
- **REST API** - Full HTTP interface for cluster management and monitoring
- **Comprehensive Testing** - Unit and integration tests with Jest
- **Logging** - Structured logging across all components

---

## Further Reading

- See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design decisions and patterns
- See [README.md](README.md) for quick-start setup instructions
- See [TEST_RESULTS.md](TEST_RESULTS.md) for test execution details

---

*Fakfa - A TypeScript-based distributed message broker simulation. Prepared for interview demonstration and educational purposes.*
