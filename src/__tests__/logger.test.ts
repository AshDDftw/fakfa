import { Logger } from '../utils/logger';

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
const mockConsoleDebug = jest.spyOn(console, 'debug').mockImplementation();

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestComponent');
    jest.clearAllMocks();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleWarn.mockRestore();
    mockConsoleDebug.mockRestore();
  });

  test('should log info messages with correct format', () => {
    logger.info('Test info message', { data: 'test' });
    
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const call = mockConsoleLog.mock.calls[0];
    expect(call[0]).toMatch(/\[.*\] \[INFO\] \[TestComponent\] Test info message/);
    expect(call[1]).toEqual({ data: 'test' });
  });

  test('should log error messages with correct format', () => {
    logger.error('Test error message', new Error('test error'));
    
    expect(mockConsoleError).toHaveBeenCalledTimes(1);
    const call = mockConsoleError.mock.calls[0];
    expect(call[0]).toMatch(/\[.*\] \[ERROR\] \[TestComponent\] Test error message/);
    expect(call[1]).toBeInstanceOf(Error);
  });

  test('should log warn messages with correct format', () => {
    logger.warn('Test warning message');
    
    expect(mockConsoleWarn).toHaveBeenCalledTimes(1);
    const call = mockConsoleWarn.mock.calls[0];
    expect(call[0]).toMatch(/\[.*\] \[WARN\] \[TestComponent\] Test warning message/);
  });

  test('should log debug messages with correct format', () => {
    logger.debug('Test debug message');
    
    expect(mockConsoleDebug).toHaveBeenCalledTimes(1);
    const call = mockConsoleDebug.mock.calls[0];
    expect(call[0]).toMatch(/\[.*\] \[DEBUG\] \[TestComponent\] Test debug message/);
  });

  test('should include component name in all log messages', () => {
    const customLogger = new Logger('CustomComponent');
    
    customLogger.info('Test message');
    
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const call = mockConsoleLog.mock.calls[0];
    expect(call[0]).toContain('[CustomComponent]');
  });

  test('should include timestamp in log messages', () => {
    const beforeLog = new Date().toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
    logger.info('Test message');
    const afterLog = new Date().toISOString().substring(0, 16);
    
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const call = mockConsoleLog.mock.calls[0];
    const logMessage = call[0];
    
    // Extract timestamp from log message
    const timestampMatch = logMessage.match(/\[(.*?)\]/);
    expect(timestampMatch).toBeTruthy();
    
    const logTimestamp = timestampMatch![1].substring(0, 16);
    expect(logTimestamp >= beforeLog && logTimestamp <= afterLog).toBeTruthy();
  });

  test('should handle multiple arguments', () => {
    logger.info('Message with args', 'arg1', 42, { key: 'value' });
    
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const call = mockConsoleLog.mock.calls[0];
    expect(call).toHaveLength(4);
    expect(call[1]).toBe('arg1');
    expect(call[2]).toBe(42);
    expect(call[3]).toEqual({ key: 'value' });
  });
});