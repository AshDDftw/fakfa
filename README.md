# Fakfa - Distributed Message Streaming Platform

A Kafka-like distributed publish-subscribe message streaming system built with Node.js and TypeScript.

## Features

- **Distributed Architecture**: Multiple brokers forming a cluster
- **Topics & Partitions**: Scalable message organization
- **Producer/Consumer**: High-throughput message publishing and consumption
- **Consumer Groups**: Load balancing across consumers
- **Persistent Storage**: Durable message logs using LevelDB
- **Replication**: Fault-tolerant message replication
- **Web Dashboard**: Real-time cluster monitoring
- **REST API**: Management and monitoring endpoints

## Quick Start

### Prerequisites

- Node.js 16+ 
- etcd (for cluster coordination)

### Installation

```bash
# Clone and install dependencies
npm install

# Build the project
npm run build
```

### Start etcd (Required for cluster coordination)

```bash
# Download and start etcd
etcd
```

### Start the Platform

```bash
# Start the main platform (controller + broker + API)
npm start
```

This starts:
- Cluster controller with etcd coordination
- Message broker on port 9092
- REST API and dashboard on port 8080

Visit http://localhost:8080 for the web dashboard.

### Start Additional Brokers

```bash
# Start additional brokers on different ports
npm run broker 9093
npm run broker 9094
```

## Usage Examples

### Create a Topic

```bash
curl -X POST http://localhost:8080/topics \
  -H "Content-Type: application/json" \
  -d '{"name": "test-topic", "partitions": 3, "replicationFactor": 2}'
```

### Producer Example

```bash
npm run producer
```

### Consumer Example

```bash
npm run consumer
```

## Architecture

### Components

1. **Cluster Controller**: Manages broker registration, topic creation, partition assignment, and leader election
2. **Message Broker**: Handles message storage, production, and consumption
3. **Commit Log**: Persistent append-only log storage using LevelDB
4. **Producer**: Publishes messages with partitioning strategies
5. **Consumer**: Subscribes to topics and manages offsets
6. **REST API**: HTTP endpoints for cluster management
7. **Web Dashboard**: Real-time monitoring interface

### Message Flow

1. **Produce**: Producer → Partition Leader → Replicas → Acknowledgment
2. **Consume**: Consumer → Partition Leader → Messages → Offset Commit

### Partition Assignment

- Round-robin distribution across brokers
- Configurable replication factor
- Automatic leader election on broker failure

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/metadata` | Cluster metadata |
| POST | `/topics` | Create topic |
| GET | `/topics` | List topics |
| GET | `/topics/:name` | Topic details |
| GET | `/brokers` | List brokers |
| POST | `/produce` | Produce message |

## Configuration

### Topic Configuration

```javascript
{
  "name": "my-topic",
  "partitions": 3,
  "replicationFactor": 2,
  "config": {
    "retentionMs": 604800000,    // 7 days
    "retentionBytes": 1073741824, // 1GB
    "segmentMs": 86400000,       // 1 day
    "segmentBytes": 104857600    // 100MB
  }
}
```

### Producer Configuration

```javascript
const producer = new MessageProducer(MessageProducer.keyHashStrategy);
await producer.connect(['localhost:9092', 'localhost:9093']);
```

### Consumer Configuration

```javascript
const consumer = new MessageConsumer('my-group', 'consumer-1');
await consumer.connect(['localhost:9092', 'localhost:9093']);
await consumer.subscribe(['my-topic']);
```

## Development

### Project Structure

```
src/
├── types/           # TypeScript interfaces
├── storage/         # Commit log implementation
├── controller/      # Cluster controller
├── broker/          # Message broker
├── producer/        # Producer client
├── consumer/        # Consumer client
├── api/            # REST API
├── dashboard/      # Web dashboard
├── examples/       # Usage examples
├── scripts/        # Utility scripts
└── utils/          # Common utilities
```

### Running Tests

```bash
npm test
```

### Development Mode

```bash
npm run dev
```

## Deployment

### Multi-Broker Setup

1. Start etcd cluster
2. Start controller: `npm run controller`
3. Start brokers: `npm run broker 9092`, `npm run broker 9093`
4. Create topics via API or dashboard

### Docker (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 8080 9092
CMD ["npm", "start"]
```

## Limitations

This is a simplified implementation for educational purposes. Production Kafka includes:

- Advanced replication protocols (ISR management)
- Exactly-once semantics
- Compacted topics
- Schema registry
- Advanced security features
- Performance optimizations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## License

MIT License - see LICENSE file for details.