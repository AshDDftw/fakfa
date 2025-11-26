import { MessageProducer } from '../producer/message-producer';
import { Logger } from '../utils/logger';

async function runProducer() {
  const logger = new Logger('ProducerExample');
  
  try {
    // Create producer with key-based partitioning
    const producer = new MessageProducer(MessageProducer.keyHashStrategy);
    
    // Connect to brokers
    await producer.connect(['localhost:9092', 'localhost:9093']);
    
    logger.info('Producer connected, starting to send messages...');

    // Send test messages
    for (let i = 0; i < 100; i++) {
      const key = `user-${i % 10}`;
      const value = {
        id: i,
        message: `Hello from producer! Message ${i}`,
        timestamp: new Date().toISOString(),
        user: key
      };

      try {
        const result = await producer.produce({
          topic: 'test-topic',
          key,
          value
        });
        
        logger.info(`Sent message ${i} to offset ${result.offset}`);
        
        // Wait a bit between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Failed to send message ${i}:`, error);
      }
    }

    await producer.close();
    logger.info('Producer finished');

  } catch (error) {
    logger.error('Producer error:', error);
    process.exit(1);
  }
}

runProducer();