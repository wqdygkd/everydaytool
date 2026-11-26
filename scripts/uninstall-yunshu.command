#!/bin/bash
# 双击即用的启动器：打开终端 → 运行同目录下的 uninstall-yunshu.sh
# 想直接「双击卸载」，只需要双击这个文件。
cd "$(dirname "$0")" || exit 1
exec /bin/bash "./uninstall-yunshu.sh" "$@"
