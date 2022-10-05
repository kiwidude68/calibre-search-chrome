@echo off
cd ..

python .build\build.py
if %ERRORLEVEL% neq 0 goto :ExitPoint

echo Build completed successfully

:ExitPoint
cd .build
