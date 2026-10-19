@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo === GameDev Board: публикация на GitHub Pages ===
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [!] Git не найден. Установите его: https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".git" git init -b main >nul

for /f "delims=" %%i in ('git config user.name') do set GN=%%i
if "%GN%"=="" (
  set /p GN=Ваше имя для коммитов:
  call git config user.name "%%GN%%"
)
for /f "delims=" %%i in ('git config user.email') do set GE=%%i
if "%GE%"=="" (
  set /p GE=Ваш email на GitHub:
  call git config user.email "%%GE%%"
)

git add -A
git commit -m "GameDev Board" >nul 2>nul
git branch -M main

where gh >nul 2>nul
if errorlevel 1 goto manual

gh auth status >nul 2>nul
if errorlevel 1 gh auth login

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  gh repo create GameDevelopmentBoard --public --source=. --remote=origin
)
git push -u origin main
echo Включаю GitHub Pages (ветка main, корень)...
gh api -X POST "repos/{owner}/{repo}/pages" -f "source[branch]=main" -f "source[path]=/" >nul 2>nul
for /f "delims=" %%u in ('gh api "repos/{owner}/{repo}/pages" --jq .html_url 2^>nul') do set URL=%%u
echo.
echo Готово! Через 1-2 минуты сайт будет доступен по адресу:
echo   %URL%
echo.
pause
exit /b 0

:manual
echo GitHub CLI (gh) не найден - тогда вручную:
echo  1. Создайте пустой публичный репозиторий на https://github.com/new
echo  2. Вставьте сюда его адрес, например https://github.com/USER/GameDevelopmentBoard.git
echo.
set /p REPO=URL репозитория:
git remote remove origin >nul 2>nul
git remote add origin %REPO%
git push -u origin main
echo.
echo  3. В репозитории откройте Settings - Pages: Source = Deploy from a branch, Branch = main, папка / (root), Save.
echo     Сайт появится по адресу https://USER.github.io/GameDevelopmentBoard/
echo.
pause
