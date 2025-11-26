import { SimpleController as ClusterController } from '../controller/simple-controller';
import { RestAPI } from '../api/rest-api';
import { Logger } from '../utils/logger';

async function startController() {
  const logger = new Logger('ControllerScript');
  
  try {
    // Start cluster controller (no etcd required)
    const controller = new ClusterController();
    await controller.start();

    // Start REST API
    const port = parseInt(process.argv[2]) || 8080;
    const api = new RestAPI(controller, port);
    await api.start();

    logger.info(`Controller and API started on port ${port}`);
    logger.info(`Dashboard available at: http://localhost:${port}`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down controller...');
      await controller.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start controller:', error);
    process.exit(1);
  }
}

startController();