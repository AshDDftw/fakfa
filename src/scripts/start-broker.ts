import { SimpleController as ClusterController } from '../controller/simple-controller';
import { MessageBroker } from '../broker/message-broker';
import { Logger } from '../utils/logger';
import * as path from 'path';

async function startBroker() {
  const logger = new Logger('BrokerScript');
  
  // Get port from command line args or use default
  const port = parseInt(process.argv[2]) || 9093;
  const host = process.argv[3] || 'localhost';
  
  try {
    // Connect to existing controller (no etcd required)
    const controller = new ClusterController();
    
    // Start broker
    const dataDir = path.join(process.cwd(), 'data');
    const broker = new MessageBroker(host, port, controller, dataDir);
    await broker.start();

    logger.info(`Broker started on ${host}:${port}`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down broker...');
      await broker.close();
      await controller.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start broker:', error);
    process.exit(1);
  }
}

startBroker();