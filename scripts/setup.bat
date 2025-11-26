@echo off
echo Setting up Fakfa Streaming Platform...

echo Installing dependencies...
call npm install

echo Building project...
call npm run build

echo Creating data directory...
if not exist "data" mkdir data

echo Setup complete!
echo.
echo To start the platform:
echo   npm start
echo.
echo To view the dashboard:
echo   http://localhost:8080
echo.
echo To start additional brokers:
echo   npm run broker 9093
echo   npm run broker 9094