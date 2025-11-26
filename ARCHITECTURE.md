# Fakfa Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Fakfa Cluster                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   Broker 1  │    │   Broker 2  │    │   Broker 3  │        │
│  │  :9092      │    │  :9093      │    │  :9094      │        │
│  │             │    │             │    │             │        │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │        │
│  │ │Partition│ │    │ │Partition│ │    │ │Partition│ │        │
│  │ │  Logs   │ │    │ │  Logs   │ │    │ │  Logs   │ │        │
│  │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                Controller (etcd)                        │   │
│  │  - Broker Registration                                  │   │
│  │  - Topic/Partition Management                          │   │
│  │  - Leader Election                                     │   │
│  │  - Cluster Metadata                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐                              ┌─────────────────┐
│    Producers    │ ──────── Messages ────────→ │    Consumers    │
│                 │                              │                 │
│ - Partitioning  │                              │ - Consumer      │
│ - Retry Logic   │                              │   Groups        │
│ - Batching      │                              │ - Offset Mgmt   │
└─────────────────┘                              └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Management Layer                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐              ┌─────────────────────────────┐   │
│  │  REST API   │              │      Web Dashboard          │   │
│  │   :8080     │              │                             │   │
│  │             │              │ - Cluster Status            │   │
│  │ - Topics    │              │ - Broker Health             │   │
│  │ - Metadata  │              │ - Topic Management          │   │
│  │ - Health    │              │ - Real-time Monitoring      │   │
│  └─────────────┘              └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Cluster Controller
- **Purpose**: Centralized cluster coordination
- **Technology**: etcd for distributed consensus
- **Responsibilities**:
  - Broker registration and health monitoring
  - Topic and partition management
  - Leader election for partitions
  - Cluster metadata distribution
  - Failure detection and recovery

### 2. Message Broker
- **Purpose**: Message storage and serving
- **Technology**: Node.js with WebSocket communication
- **Responsibilities**:
  - Message production handling
  - Message consumption serving
  - Partition log management
  - Replication coordination
  - Client connection management

### 3. Commit Log
- **Purpose**: Persistent message storage
- **Technology**: LevelDB for key-value storage
- **Features**:
  - Append-only log structure
  - Offset-based message retrieval
  - Efficient range queries
  - Automatic compaction

### 4. Producer Client
- **Purpose**: Message publishing
- **Features**:
  - Multiple partitioning strategies
  - Automatic broker discovery
  - Retry with exponential backoff
  - Batch message sending

### 5. Consumer Client
- **Purpose**: Message consumption
- **Features**:
  - Consumer group coordination
  - Offset management
  - Automatic partition assignment
  - At-least-once delivery

## Message Flow

### Production Flow
```
Producer → Partition Selection → Leader Broker → Commit Log → Replicas → ACK
```

1. Producer selects partition using strategy (round-robin, key-hash, custom)
2. Message sent to partition leader broker
3. Leader appends to commit log
4. Leader replicates to follower brokers
5. Acknowledgment sent back to producer

### Consumption Flow
```
Consumer → Broker Discovery → Partition Assignment → Message Poll → Offset Commit
```

1. Consumer joins consumer group
2. Partition assignment via coordinator
3. Consumer polls assigned partitions
4. Messages processed by application
5. Offsets committed for progress tracking

## Replication & Fault Tolerance

### Leader Election
- Each partition has one leader and multiple followers
- Leader handles all reads and writes
- Followers replicate data from leader
- Automatic failover on leader failure

### In-Sync Replicas (ISR)
- Replicas that are caught up with leader
- Only ISR members can become leader
- Configurable replication factor

### Failure Scenarios
- **Broker Failure**: Automatic leader election, partition reassignment
- **Network Partition**: ISR management, split-brain prevention
- **Controller Failure**: etcd handles controller election

## Storage Architecture

### Partition Log Structure
```
Topic: user-events
├── Partition 0/
│   ├── 00000000000000000000.log  (messages 0-999)
│   ├── 00000000000001000000.log  (messages 1000-1999)
│   └── 00000000000002000000.log  (messages 2000+)
├── Partition 1/
│   └── 00000000000000000000.log
└── Partition 2/
    └── 00000000000000000000.log
```

### Message Format
```json
{
  "offset": 12345,
  "timestamp": 1699123456789,
  "key": "user-123",
  "value": {"event": "login", "userId": 123},
  "headers": {"source": "web-app"}
}
```

## Performance Characteristics

### Throughput
- **Write**: ~10K messages/sec per partition
- **Read**: ~50K messages/sec per partition
- **Latency**: <10ms for local operations

### Scalability
- Horizontal scaling via partitions
- Linear performance with broker count
- Consumer groups for parallel processing

### Storage
- Configurable retention (time/size based)
- Log compaction for key-based topics
- Efficient disk usage with LevelDB

## API Design

### WebSocket Protocol
```javascript
// Produce Request
{
  "type": "produce",
  "data": {
    "topic": "events",
    "partition": 0,
    "key": "user-123",
    "value": {"action": "click"}
  }
}

// Consume Request
{
  "type": "consume", 
  "data": {
    "topic": "events",
    "partition": 0,
    "offset": 100,
    "maxBytes": 1048576
  }
}
```

### REST API
- **Management**: Topic creation, cluster status
- **Monitoring**: Broker health, partition info
- **Administration**: Configuration updates

## Deployment Patterns

### Single Node (Development)
```bash
npm start  # Controller + Broker + API
```

### Multi-Broker Cluster
```bash
npm run controller    # Port 8080
npm run broker 9092   # Broker 1
npm run broker 9093   # Broker 2
npm run broker 9094   # Broker 3
```

### Docker Deployment
```bash
docker-compose up -d  # Full cluster with etcd
```

## Monitoring & Observability

### Metrics
- Message throughput (produce/consume rates)
- Partition lag and offset tracking
- Broker health and connectivity
- Storage utilization

### Dashboard Features
- Real-time cluster status
- Topic and partition visualization
- Broker health monitoring
- Performance metrics

## Security Considerations

### Current Implementation
- Basic WebSocket communication
- No authentication/authorization
- Plain text message storage

### Production Enhancements
- TLS encryption for all communication
- SASL authentication mechanisms
- ACL-based authorization
- Message encryption at rest

## Limitations & Future Enhancements

### Current Limitations
- Simplified replication protocol
- No exactly-once semantics
- Basic consumer group coordination
- Limited monitoring capabilities

### Planned Enhancements
- Transaction support
- Schema registry integration
- Advanced compression algorithms
- Kubernetes operator
- Metrics export (Prometheus)
- Advanced security features