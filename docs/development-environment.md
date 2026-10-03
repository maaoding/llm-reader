# 云端 Linux 开发环境

需要 x86_64 Linux、Node.js 24+、Corepack，以及使用签名软件源的 APT 和 `dpkg-deb`。当前 Debian 13 环境已具备这些基础工具。pnpm 使用 `package.json` 中固定的版本和校验值，不自行追踪最新版。

在仓库目录执行一次：

```bash
bash scripts/setup-cloud-environment.sh --with-wine
source "$HOME/.local/share/llm-reader-env/activate.sh"
pnpm install --frozen-lockfile
```

脚本无需管理员权限，将 pnpm、Xvfb、`xvfb-run`、Wine 安装到 `~/.local/bin`，系统工具及其依赖保存在 `~/.local/share/llm-reader-env/sysroot`。APT 只下载并验证软件包，不修改宿主机的系统包、软件源或架构设置。重复执行会复用已经准备好的工具和下载缓存。仅进行 Linux 开发时，可省略 `--with-wine`。

有些云端内核不能运行 32 位 Linux 程序。脚本会检测此限制，必要时从同一套签名 APT 软件源下载 QEMU，通过 Wine 的静态预加载器运行 32 位 Windows 辅助进程。NSIS 即使打包 x64 应用，也需要这些辅助进程。初始化结束时会实际检查 Xvfb，并分别运行 Wine 的 32 位和 64 位 `cmd.exe`；检查失败时脚本返回失败。

初始化脚本不会调用模型接口、读取日常书库或发布安装包。它保留环境提供的代理与 CA 配置；Wine 的库路径只作用于 Wine 进程，不导出到 Node.js 或 Electron。

如果环境需要重建，在环境设置的初始化命令中保存上面的三条命令，工作目录选择仓库目录。此文件和脚本随仓库保存；当前机器中执行过安装命令不等于更新了环境设置。

## 验证与打包

无桌面 Linux 的 Electron 测试通过 Xvfb 运行：

```bash
xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24 -nolisten tcp' \
  env LLM_READER_E2E_BASIC_TEXT=1 pnpm test:e2e
```

`LLM_READER_E2E_BASIC_TEXT=1` 仅供测试使用隔离临时数据目录及合成密钥，不用于日常启动应用。

在 Linux 生成 Windows 安装包并检查 Wine 时，显式使用已经安装的 Wine，关闭自动发布：

```bash
pnpm build:app
xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24 -nolisten tcp' \
  env USE_SYSTEM_WINE=true pnpm exec electron-builder --win nsis --publish never
```

工具准备脚本不会自动更新项目依赖。常规依赖重装仍使用锁文件；Electron 二进制下载由项目已允许的安装步骤完成。
