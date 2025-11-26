@echo off
echo Starting Fakfa Demo...

echo Step 1: Starting platform...
start "Fakfa Platform" cmd /k "npm start"

timeout /t 10 /nobreak > nul

echo Step 2: Creating test topic...
curl -X POST http://localhost:8080/topics -H "Content-Type: application/json" -d "{\"name\": \"demo-topic\", \"partitions\": 3, \"replicationFactor\": 1}"

timeout /t 3 /nobreak > nul

echo Step 3: Starting producer...
start "Producer" cmd /k "npm run producer"

timeout /t 5 /nobreak > nul

echo Step 4: Starting consumer...
start "Consumer" cmd /k "npm run consumer"

echo.
echo Demo started! Check the following:
echo - Dashboard: http://localhost:8080
echo - Producer and Consumer windows
echo.
echo Press any key to exit...
pause > nul