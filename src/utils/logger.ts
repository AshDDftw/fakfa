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

  warn(message: string, ...args: any[]) {
    console.warn(`[${new Date().toISOString()}] [WARN] [${this.component}] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]) {
    console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.component}] ${message}`, ...args);
  }
}