@echo off
echo Local addresses for MTG Tabletop:
echo.
for /f "tokens=14" %%a in ('ipconfig ^| findstr /R /C:"IPv4.*192\\." /C:"IPv4.*10\\." /C:"IPv4.*172\\."') do (
  echo Frontend: http://%%a:5180
  echo Backend:  http://%%a:8787/health
  echo.
)
echo If nothing is printed above, run ipconfig and look for your Wi-Fi/Ethernet IPv4 address.
