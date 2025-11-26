import { MessageConsumer } from '../consumer/message-consumer';
import { Logger } from '../utils/logger';

async function runConsumer() {
  const logger = new Logger('ConsumerExample');
  
  try {
    // Create consumer
    const consumer = new MessageConsumer('test-group', 'consumer-1');
    
    // Connect to brokers
    await consumer.connect(['localhost:9092', 'localhost:9093']);
    
    // Subscribe to topics
    await consumer.subscribe(['test-topic']);
    
    logger.info('Consumer started, polling for messages...');

    // Poll for messages
    let messageCount = 0;
    const startTime = Date.now();

    while (true) {
      try {
        const messages = await consumer.poll(5000); // 5 second timeout
        
        for (const message of messages) {
          messageCount++;
          logger.info(`Received message ${messageCount}: ${JSON.stringify(message.value)} (offset: ${message.offset})`);
        }

        if (messages.length > 0) {
          // Commit offsets after processing
          await consumer.commitOffsets();
        }

        // Stop after 2 minutes or 50 messages
        if (Date.now() - startTime > 120000 || messageCount >= 50) {
          break;
        }

      } catch (error) {
        logger.error('Error polling messages:', error);
      }
    }

    await consumer.close();
    logger.info(`Consumer finished. Processed ${messageCount} messages.`);

  } catch (error) {
    logger.error('Consumer error:', error);
    process.exit(1);
  }
}

runConsumer();