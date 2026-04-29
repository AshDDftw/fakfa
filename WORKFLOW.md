# Fakfa Workflow: Complete System Flow

## Table of Contents
1. [System Startup](#system-startup)
2. [Message Production Flow](#message-production-flow)
3. [Message Storage Flow](#message-storage-flow)
4. [Message Consumption Flow](#message-consumption-flow)
5. [Complete End-to-End Flow](#complete-end-to-end-flow)
6. [Interactive Examples](#interactive-examples)

---

## System Startup

### Startup Sequence Diagram

```
┌──────────────┐
│   main()     │
│  index.ts    │
└──────┬───────┘
       │
       ├─→ ┌─────────────────────────────────────┐
       │   │ 1. Initialize Controller            │
       │   │ SimpleController created            │
       │   │ Manages broker registry & metadata  │
       │   └─────────────────────────────────────┘
       │
       ├─→ ┌─────────────────────────────────────┐
       │   │ 2. Start Message Broker             │
       │   │ - Create WebSocket Server           │
       │   │ - Listen on port 9092               │
       │   │ - Register with Controller          │
       │   │ - Start heartbeat service           │
       │   └─────────────────────────────────────┘
       │
       └─→ ┌─────────────────────────────────────┐
           │ 3. Start REST API Server            │
           │ - Create HTTP Server                │
           │ - Serve Dashboard on port 8080      │
           │ - Register endpoints                │
           └─────────────────────────────────────┘
```

### Startup Code Flow

**File:** [src/index.ts](src/index.ts)

```typescript
async function main() {
  const logger = new Logger('Main');
  
  try {
    // Step 1: Start Controller (Manages cluster metadata)
    const controller = new ClusterController();
    await controller.start();

    // Step 2: Start Message Broker (Handles messages)
    const dataDir = path.join(process.cwd(), 'data');
    const broker = new MessageBroker('localhost', 9092, controller, dataDir);
    await broker.start();

    // Step 3: Start REST API & Dashboard
    const api = new RestAPI(controller, 8080);
    await api.start();

    logger.info('Dashboard available at: http://localhost:8080');
    logger.info('Broker running on: localhost:9092');
  }
}
```

---

## Message Production Flow

### Producer Connection & Initialization

```
┌─────────────────┐
│   Producer      │
│   Client        │
└────────┬────────┘
         │
         ├─→ ┌──────────────────────────────────────┐
         │   │ 1. Create Producer Instance          │
         │   │ - Set partitioning strategy          │
         │   │ - Initialize logger                  │
         │   │ Files: message-producer.ts           │
         │   └──────────────────────────────────────┘
         │
         ├─→ ┌──────────────────────────────────────┐
         │   │ 2. Connect to Brokers                │
         │   │ - WebSocket connections              │
         │   │ - Multiple broker support            │
         │   │ - Retry on failure                   │
         │   └──────────────────────────────────────┘
         │
         └─→ ┌──────────────────────────────────────┐
             │ 3. Fetch Cluster Metadata            │
             │ - Get topic/partition info           │
             │ - Get broker list                    │
             │ - Ready to produce                   │
             └──────────────────────────────────────┘
```

### Producer Code Example

**File:** [src/examples/producer.ts](src/examples/producer.ts)

```typescript
import { MessageProducer } from '../producer/message-producer';

async function runProducer() {
  // 1. Create Producer with key-based partitioning strategy
  const producer = new MessageProducer(MessageProducer.keyHashStrategy);
  
  // 2. Connect to brokers
  await producer.connect(['localhost:9092', 'localhost:9093']);
  
  // 3. Send messages
  for (let i = 0; i < 100; i++) {
    const result = await producer.produce({
      topic: 'test-topic',
      key: `user-${i % 10}`,  // Same keys go to same partition
      value: {
        id: i,
        message: `Hello from producer! Message ${i}`,
        timestamp: new Date().toISOString()
      }
    });
    
    console.log(`Sent message ${i} to offset ${result.offset}`);
  }
}
```

### Producer Produce Request Flow

```
Producer.produce(request)
    ↓
┌─────────────────────────────────────────────┐
│ 1. Determine Target Partition               │
│ - Use partition strategy (round-robin,      │
│   key-hash, random)                         │
│ - Metadata lookup for topic                 │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 2. Select Broker                            │
│ - Choose broker handling target partition   │
│ - Use round-robin if multiple               │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 3. Send via WebSocket                       │
│ - ProduceRequest message format             │
│ {                                           │
│   type: 'produce',                          │
│   data: {                                   │
│     topic: 'test-topic',                    │
│     partition: 0,                           │
│     key: 'user-123',                        │
│     value: {...}                            │
│   }                                         │
│ }                                           │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 4. Receive Response                         │
│ { offset: 42 }                              │
│ Message stored at offset 42                 │
└─────────────────────────────────────────────┘
```

**File:** [src/producer/message-producer.ts](src/producer/message-producer.ts)

```typescript
async produce(request: ProduceRequest): Promise<{ offset: number }> {
  if (!this.metadata) {
    throw new Error('No cluster metadata available');
  }

  // 1. Determine partition using strategy
  const partition = this.partitionStrategy(
    request.key,
    request.topic,
    this.metadata
  );

  // 2. Select broker handling this partition
  const brokerEndpoint = this.selectBroker(partition);
  const connection = this.connections.get(brokerEndpoint);
  
  if (!connection) {
    throw new Error(`Not connected to broker: ${brokerEndpoint}`);
  }

  // 3. Send produce request
  return new Promise<{ offset: number }>((resolve, reject) => {
    const request_data = {
      type: 'produce',
      data: {
        topic: request.topic,
        partition,
        key: request.key,
        value: request.value,
        headers: request.headers
      }
    };

    connection.send(JSON.stringify(request_data));

    // Wait for response
    const handler = (data: WebSocket.Data) => {
      const response = JSON.parse(data.toString());
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
      connection.off('message', handler);
    };

    connection.on('message', handler);
  });
}
```

---

## Message Storage Flow

### Broker Message Handling

```
Broker receives WebSocket message
    ↓
┌────────────────────────────────────────────────┐
│ Parse & Validate Request                       │
│ - Check request.type === 'produce'             │
│ - Validate required fields                     │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ Get/Create Commit Log for Partition            │
│ - Key format: "{topic}-{partition}"            │
│ - Example: "test-topic-0"                      │
│ - Create if doesn't exist                      │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ Append Message to Commit Log                   │
│ - Add timestamp: Date.now()                    │
│ - Get next offset                              │
│ - Persist to LevelDB                           │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ Send Response to Producer                      │
│ { offset: assigned_offset }                    │
└────────────────────────────────────────────────┘
```

### Broker Code Implementation

**File:** [src/broker/message-broker.ts](src/broker/message-broker.ts)

```typescript
private async handleProduce(request: ProduceRequest): Promise<{ offset: number }> {
  // Step 1: Get or create commit log for partition
  const logKey = `${request.topic}-${request.partition || 0}`;
  let log = this.logs.get(logKey);
  
  if (!log) {
    log = new CommitLog(this.dataDir, request.topic, request.partition || 0);
    this.logs.set(logKey, log);
  }

  // Step 2: Append message to log
  const offset = await log.append({
    key: request.key,
    value: request.value,
    headers: request.headers,
    timestamp: Date.now()
  });
  
  // Step 3: Return assigned offset
  return { offset };
}
```

### Commit Log Storage

```
CommitLog.append(message)
    ↓
┌─────────────────────────────────────────────┐
│ Generate Next Offset                        │
│ - Increment this.nextOffset                 │
│ - Returns unique position in log            │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Store in LevelDB                            │
│ - Key: offset (as string)                   │
│ - Value: serialized message                 │
│ - Example:                                  │
│   db.put('42', JSON.stringify({             │
│     key: 'user-123',                        │
│     value: {...},                           │
│     timestamp: 1234567890,                  │
│     offset: 42                              │
│   }))                                       │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Return Offset Number                        │
│ Producer now knows message location         │
└─────────────────────────────────────────────┘
```

**File:** [src/storage/commit-log.ts](src/storage/commit-log.ts)

```typescript
async append(message: Omit<Message, 'offset'>): Promise<number> {
  // 1. Generate next offset
  const offset = this.nextOffset++;
  
  // 2. Create message with offset
  const fullMessage: Message = {
    ...message,
    offset
  };

  // 3. Persist to LevelDB
  const key = offset.toString();
  const value = JSON.stringify(fullMessage);
  
  await this.db.put(key, value);
  
  // 4. Return offset
  return offset;
}

async getByOffset(offset: number): Promise<Message | null> {
  try {
    const value = await this.db.get(offset.toString());
    return JSON.parse(value);
  } catch (error) {
    return null;  // Offset not found
  }
}
```

---

## Message Consumption Flow

### Consumer Connection & Subscription

```
Consumer Client Created
    ↓
┌────────────────────────────────────────────────┐
│ 1. Initialize Consumer                         │
│ - groupId: 'my-group'                          │
│ - consumerId: unique identifier                │
│ - offsets: Map<partition, offset>              │
│ Files: message-consumer.ts                     │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ 2. Connect to Brokers                          │
│ - WebSocket connections (same as producer)    │
│ - Multiple broker support                      │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ 3. Fetch Metadata                              │
│ - Learn about topics/partitions                │
└────────────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────────────┐
│ 4. Subscribe to Topics                         │
│ - Receive partition assignments                │
│ - Assign to partitions in group                │
└────────────────────────────────────────────────┘
```

### Consumer Code Example

**File:** [src/examples/consumer.ts](src/examples/consumer.ts)

```typescript
import { MessageConsumer } from '../consumer/message-consumer';

async function runConsumer() {
  // 1. Create consumer with group ID
  const consumer = new MessageConsumer('my-consumer-group', 'consumer-1');
  
  // 2. Connect to brokers
  await consumer.connect(['localhost:9092', 'localhost:9093']);
  
  // 3. Subscribe to topics
  await consumer.subscribe(['test-topic']);
  
  // 4. Poll and consume messages
  while (true) {
    const messages = await consumer.poll();
    
    for (const message of messages) {
      console.log(`Consumed from partition ${message.partition}:`, message.value);
      
      // Process message
      processMessage(message);
    }
    
    // Commit offsets after processing
    await consumer.commit();
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

### Consumer Poll Flow

```
consumer.poll()
    ↓
┌──────────────────────────────────────────────┐
│ Get Assigned Partitions                      │
│ - Query assignments from controller           │
│ - Example: topic-0, topic-1, topic-2         │
└──────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────┐
│ For Each Partition:                          │
│                                              │
│ 1. Get Current Offset                        │
│    - Check this.offsets map                  │
│    - Default: 0 if not found                 │
│                                              │
│ 2. Send Consume Request                      │
│    {                                         │
│      type: 'consume',                        │
│      data: {                                 │
│        topic: 'test-topic',                  │
│        partition: 0,                         │
│        offset: 42,    // start from here     │
│        maxBytes: 1048576                     │
│      }                                       │
│    }                                         │
└──────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────┐
│ Broker Fetches Messages from Commit Log      │
│ - getByOffset(42) returns message            │
│ - Batch multiple if available                │
│ - Return up to maxBytes                      │
└──────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────┐
│ Return Messages to Consumer                  │
│ [Message, Message, ...]                      │
└──────────────────────────────────────────────┘
```

**File:** [src/consumer/message-consumer.ts](src/consumer/message-consumer.ts)

```typescript
async poll(timeoutMs: number = 5000): Promise<Message[]> {
  const messages: Message[] = [];

  // Get current offset for each partition
  for (const assignment of this.assignments) {
    const key = `${assignment.topic}-${assignment.partition}`;
    const offset = this.offsets.get(key) || 0;

    // Send consume request to broker
    const consumeRequest = {
      type: 'consume',
      data: {
        topic: assignment.topic,
        partition: assignment.partition,
        offset,
        maxBytes: 1048576  // 1MB
      }
    };

    // Get broker connection for this partition
    const brokerEndpoint = this.getBrokerForPartition(assignment);
    const connection = this.connections.get(brokerEndpoint);

    // Wait for response
    const response = await this.sendRequest(connection, consumeRequest);
    
    // Update offset tracker
    for (const message of response.messages) {
      this.offsets.set(key, message.offset + 1);
      messages.push(message);
    }
  }

  return messages;
}
```

### Offset Management

```
Consumer State Tracking
    ↓
┌──────────────────────────────────────────────┐
│ Offset Map                                   │
│ "test-topic-0" → 42                          │
│ "test-topic-1" → 85                          │
│ "test-topic-2" → 120                         │
│                                              │
│ Each partition tracks where consumer is      │
└──────────────────────────────────────────────┘
    ↓
    ├─→ Process Message at Offset 42
    │       ↓
    │   Do Work
    │       ↓
    │   Success? → Update offset to 43
    │       
    └─→ On consumer.commit()
        Send offset updates to broker
        Enables resuming from exact position
```

---

## Complete End-to-End Flow

### Full Message Journey

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MESSAGE JOURNEY                                  │
├─────────────────────────────────────────────────────────────────────────┤

1. PRODUCER SENDS MESSAGE
   ┌─────────────────────────────────┐
   │ Producer Client                 │
   │ produce({                       │
   │   topic: 'test-topic',          │
   │   key: 'user-123',              │
   │   value: { data: 'hi' }         │
   │ })                              │
   └────────────┬────────────────────┘
                │
                ├─→ Select Partition: 0 (key-hash strategy)
                │
                ├─→ Select Broker: localhost:9092
                │
                └─→ Send WebSocket: { type: 'produce', data: {...} }
                
2. BROKER RECEIVES & STORES
   ┌──────────────────────────────────┐
   │ Message Broker:9092              │
   │ handleProduce() called           │
   └────────────┬─────────────────────┘
                │
                ├─→ Get CommitLog for "test-topic-0"
                │
                ├─→ CommitLog.append(message)
                │
                ├─→ LevelDB stores with offset: 42
                │
                └─→ Send response: { offset: 42 }

3. PRODUCER GETS CONFIRMATION
   ┌──────────────────────────────────┐
   │ Producer Client                  │
   │ Receives: { offset: 42 }         │
   │ ✓ Knows message is stored        │
   └──────────────────────────────────┘

4. CONSUMER POLLS FOR MESSAGES
   ┌──────────────────────────────────┐
   │ Consumer Client                  │
   │ Subscribes to 'test-topic'       │
   │ Assigned partition: 0            │
   │ Current offset: 0                │
   └────────────┬─────────────────────┘
                │
                └─→ Send: {
                      type: 'consume',
                      data: {
                        topic: 'test-topic',
                        partition: 0,
                        offset: 0
                      }
                    }

5. BROKER RETRIEVES MESSAGE
   ┌──────────────────────────────────┐
   │ Message Broker                   │
   │ handleConsume() called           │
   │ Get "test-topic-0" CommitLog     │
   │ getByOffset(42) finds message    │
   └────────────┬─────────────────────┘
                │
                └─→ Response: {
                      messages: [{
                        offset: 42,
                        key: 'user-123',
                        value: { data: 'hi' },
                        timestamp: 1234567890
                      }]
                    }

6. CONSUMER PROCESSES MESSAGE
   ┌──────────────────────────────────┐
   │ Consumer Client                  │
   │ Got message from offset 42       │
   │ Process: console.log(msg)        │
   │ Success!                         │
   └────────────┬─────────────────────┘
                │
                └─→ Commit offset 43
                    (Ready for next message)

└─────────────────────────────────────────────────────────────────────────┘
```

---

## Interactive Examples

### Example 1: Running Complete Demo

```bash
# Terminal 1: Start Broker & Controller
npm run start

# Terminal 2: Run Producer (in scripts/demo.bat or manually)
cd src/examples
ts-node producer.ts

# Terminal 3: Run Consumer
cd src/examples
ts-node consumer.ts

# Browser: View Dashboard
# Open http://localhost:8080
```

### Example 2: Step-by-Step Producer Flow

```typescript
// File: src/examples/producer.ts

import { MessageProducer } from '../producer/message-producer';
import { Logger } from '../utils/logger';

const logger = new Logger('Example');

async function demo() {
  // Step 1: Create producer with key-hash strategy
  // Messages with same key go to same partition
  const producer = new MessageProducer(MessageProducer.keyHashStrategy);
  
  logger.info('Step 1: Producer created');

  // Step 2: Connect to brokers
  // Establishes WebSocket connections
  await producer.connect(['localhost:9092']);
  
  logger.info('Step 2: Connected to broker');

  // Step 3: Produce first message
  const result1 = await producer.produce({
    topic: 'orders',
    key: 'order-123',           // Same key = same partition
    value: {
      orderId: 1,
      customerId: 'cust-1',
      items: ['item-1', 'item-2'],
      total: 99.99
    }
  });
  
  logger.info(`Step 3: Message sent to offset ${result1.offset}`);
  
  // Step 4: Produce another message (same customer)
  const result2 = await producer.produce({
    topic: 'orders',
    key: 'order-123',           // Same partition!
    value: {
      orderId: 2,
      customerId: 'cust-1',
      items: ['item-3'],
      total: 49.99
    }
  });
  
  logger.info(`Step 4: Second message to offset ${result2.offset}`);
  
  // Both messages in same partition, preserving order for same key
  
  await producer.close();
}

demo().catch(err => logger.error('Demo failed:', err));
```

### Example 3: Step-by-Step Consumer Flow

```typescript
// File: src/examples/consumer.ts

import { MessageConsumer } from '../consumer/message-consumer';
import { Logger } from '../utils/logger';

const logger = new Logger('Example');

async function demo() {
  // Step 1: Create consumer in group
  // Multiple consumers in same group share partitions
  const consumer = new MessageConsumer('order-processors', 'processor-1');
  
  logger.info('Step 1: Consumer created in group "order-processors"');

  // Step 2: Connect to brokers
  await consumer.connect(['localhost:9092']);
  
  logger.info('Step 2: Connected to broker');

  // Step 3: Subscribe to topics
  // Gets assigned partitions (0, 1, 2, etc.)
  await consumer.subscribe(['orders']);
  
  logger.info('Step 3: Subscribed to topic "orders"');

  // Step 4: Poll for messages
  let messageCount = 0;
  
  while (messageCount < 10) {
    // Poll blocks until timeout or messages received
    const messages = await consumer.poll(1000);
    
    if (messages.length === 0) {
      logger.info('Step 4a: No messages received (poll timeout)');
      continue;
    }
    
    logger.info(`Step 4b: Received ${messages.length} messages`);

    // Step 5: Process each message
    for (const message of messages) {
      logger.info(`Processing offset ${message.offset}:`, message.value);
      
      // Business logic here
      processOrder(message.value);
      
      messageCount++;
    }

    // Step 6: Commit offsets after processing
    // Tells broker we've processed up to this offset
    await consumer.commit();
    
    logger.info(`Step 6: Committed offsets`);
  }

  await consumer.close();
  logger.info('Consumer finished processing 10 messages');
}

function processOrder(orderData: any) {
  // In real app: save to DB, send notification, etc.
  console.log(`📦 Processing order:`, orderData.orderId);
}

demo().catch(err => logger.error('Demo failed:', err));
```

---

## Architecture Reference

### Component Interactions

```
┌──────────────────────────────────────────────────────────────┐
│                   FAKFA SYSTEM                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────┐      ┌────────────────────┐        │
│  │ MessageProducer    │      │ MessageConsumer    │        │
│  │ (src/producer/)    │      │ (src/consumer/)    │        │
│  └──────────┬─────────┘      └──────────┬─────────┘        │
│             │                           │                   │
│             └───────────┬───────────────┘                    │
│                         │ WebSocket                          │
│                         ↓                                    │
│             ┌───────────────────────┐                        │
│             │   MessageBroker       │                        │
│             │  :9092                │                        │
│             │ (src/broker/)         │                        │
│             └───────────┬───────────┘                        │
│                         │                                    │
│                         ↓                                    │
│             ┌───────────────────────┐                        │
│             │    CommitLog          │                        │
│             │  (src/storage/)       │                        │
│             │   + LevelDB           │                        │
│             └───────────┬───────────┘                        │
│                         │                                    │
│                         ↓ Persist                            │
│             ┌───────────────────────┐                        │
│             │  data/                │                        │
│             │  (LevelDB store)      │                        │
│             └───────────────────────┘                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   SimpleController (src/controller/)                │   │
│  │   - Broker registry                                 │   │
│  │   - Topic metadata                                  │   │
│  │   - Partition assignments                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   RestAPI (src/api/) + Dashboard (src/dashboard/)   │   │
│  │   :8080                                             │   │
│  │   - Cluster status                                  │   │
│  │   - Topic management                                │   │
│  │   - Broker health                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### File Organization

```
Files Used in Production Flow:
├── src/index.ts                           [Main entry point]
│   └─ Starts controller, broker, API
│
├── src/producer/message-producer.ts       [Producer logic]
│   ├─ connect()
│   ├─ produce()
│   └─ Partition strategies
│
├── src/broker/message-broker.ts           [Broker logic]
│   ├─ handleProduce()
│   ├─ handleConsume()
│   └─ handleMetadata()
│
├── src/storage/commit-log.ts              [Message storage]
│   ├─ append()
│   ├─ getByOffset()
│   └─ LevelDB integration
│
├── src/consumer/message-consumer.ts       [Consumer logic]
│   ├─ connect()
│   ├─ subscribe()
│   ├─ poll()
│   └─ Offset tracking
│
├── src/controller/simple-controller.ts    [Cluster coordination]
│   ├─ registerBroker()
│   ├─ getMetadata()
│   └─ assignPartitions()
│
├── src/api/rest-api.ts                    [HTTP endpoints]
│   └─ Dashboard & status endpoints
│
└── src/examples/                          [Runnable examples]
    ├── producer.ts                        [Producer example]
    └── consumer.ts                        [Consumer example]

Data Files:
└── data/                                  [LevelDB storage]
    └─ topic-partition-X/...              [Messages persist here]
```

---

## Key Concepts

### Partitioning Strategy
- **Key-Hash**: Messages with same key → same partition (order guaranteed)
- **Round-Robin**: Distribute evenly across partitions
- **Random**: Distribute randomly

### Offset Management
- **Producer**: Gets offset after message is stored
- **Consumer**: Tracks offset for each partition assignment
- **Commit**: Tells broker consumer has processed up to offset X

### Consumer Groups
- Multiple consumers sharing same group split partitions
- Enables parallel processing
- Each partition assigned to one consumer only

---

## Testing & Validation

Run tests to see all workflows in action:

```bash
npm test

# Individual test files:
npm test -- commit-log.test.ts
npm test -- message-producer.test.ts
npm test -- message-consumer.test.ts
npm test -- integration.test.ts
```

Tests cover:
- Message production and offset assignment
- Message consumption with offset tracking
- Consumer group partition assignment
- Offset commit and recovery
