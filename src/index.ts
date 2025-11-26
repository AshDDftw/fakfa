import { SimpleController as ClusterController } from './controller/simple-controller';
import { MessageBroker } from './broker/message-broker';
import { RestAPI } from './api/rest-api';
import { Logger } from './utils/logger';
import * as path from 'path';

async function main() {
  const logger = new Logger('Main');
  
  try {
    // Start cluster controller (no etcd required)
    const controller = new ClusterController();
    await controller.start();

    // Start first broker
    const dataDir = path.join(process.cwd(), 'data');
    const broker = new MessageBroker('localhost', 9092, controller, dataDir);
    await broker.start();

    // Start REST API with dashboard
    const api = new RestAPI(controller, 8080);
    await api.start();

    logger.info('Fakfa streaming platform started successfully!');
    logger.info('Dashboard available at: http://localhost:8080');
    logger.info('Broker running on: localhost:9092');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await broker.close();
      await controller.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start platform:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}