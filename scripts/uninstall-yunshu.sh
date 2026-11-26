#!/bin/bash
# =============================================================================
# uninstall-yunshu.sh — 云枢 / eagleyun SASE 客户端 一键卸载（macOS）
#
# 目标清单写死在 TARGETS 里（运行期不接受任何外部路径参数），逐条精确匹配：
#   /Applications/Yunshu.app
#   /Library/Application Support/Yunshu
#   /opt/.yunshu/
#   /Library/LaunchAgents/com.eagleyun.endpoint.agent.plist
#   /Library/LaunchDaemons/com.eagleyun.sase.helper.plist
#   /Library/LaunchDaemons/com.eagleyun.sase.servicemanager.plist
#   /Library/PrivilegedHelperTools/com.eagleyun.sase.helper
#   /Library/Logs/com.eagleyun.sase.helper/
#   ~/Library/Logs/com.eagleyun.sase/
#   /Library/Logs/DiagnosticReports/*Yunshu*  与  *eagleyun*
#   ~/Library/Preferences/com.eagleyun.sase.plist
#   ~/Library/Preferences/com.eagleyun.endpoint.agent.plist
#   ~/Library/Application Support/EagleCloud/
#   /Library/Application Support/EagleCloud          （扫描补充：系统级同名目录）
#   ~/Library/Caches/com.eagleyun.endpoint.agent     （扫描补充：用户缓存）
#   /opt/yunshu                                      （扫描补充：引擎数据/DB）
#   ~/Library/HTTPStorages/com.eagleyun.sase
#   ~/Library/HTTPStorages/com.eagleyun.endpoint.agent
#   ~/Library/WebKit/com.eagleyun.sase
#   /tmp/tbmdmexecutor-ipc-*
#
# 执行顺序：预览清单 → 二次确认 → 停止进程 / 卸载 launchd 服务 → 移入废纸篓
# 默认把文件移入 ~/.Trash（Finder 里能看见、能拖回），--purge 才是直接 rm -rf。
#
# 用法：
#   sudo ./uninstall-yunshu.sh                 # 预览 → 确认 → 移入废纸篓
#   sudo ./uninstall-yunshu.sh --dry-run       # 只预览，什么都不改
#   sudo ./uninstall-yunshu.sh --status        # 同上（只看残留状态）
#   sudo ./uninstall-yunshu.sh --purge         # 不进废纸篓，直接永久删除（需手输 DELETE）
#   sudo ./uninstall-yunshu.sh --yes           # 跳过确认（脚本化）
#   sudo ./uninstall-yunshu.sh --include-optional   # 附带清理用户级崩溃报告
#   sudo ./uninstall-yunshu.sh --forget-receipts    # 同时 forget eagleyun 的 pkg 收据
#   sudo ./uninstall-yunshu.sh --delete-cert   # 连钥匙串根证书一起删（非交互时生效）
#   sudo ./uninstall-yunshu.sh --keep-cert     # 完全不碰钥匙串
#   ./uninstall-yunshu.sh --help               # 显示本帮助
#
# 钥匙串证书（EagleCloud Root CA，别名 sase@eagleyun.com）：
#   登录钥匙串 ~/Library/Keychains/login.keychain-db 与系统钥匙串
#   /Library/Keychains/System.keychain 都会查；找到后默认会问你一句再删，
#   删前比对 SHA-256 31:92:90:37:…:D4:48，对不上就只给指引不动手。
# =============================================================================

set -uo pipefail
export LC_ALL=C

SCRIPT_VERSION="1.1.0"
SELF_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
SELF_PATH="$SELF_DIR/$(basename "$0")"

DRY_RUN=0
ASSUME_YES=0
PURGE=0
INCLUDE_OPTIONAL=0
FORGET_RECEIPTS=0
STATUS_ONLY=0
DELETE_CERT=0     # 非交互模式下是否也删证书
KEEP_CERT=0       # 完全不碰钥匙串

usage() {
  sed -n '/^# 用法：/,/^# =====/p' "$SELF_PATH" \
    | sed -e 's/^# \{0,1\}//' \
    | grep -v '^=\{3,\}$'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n)        DRY_RUN=1 ;;
    --yes|-y)            ASSUME_YES=1 ;;
    --purge)             PURGE=1 ;;
    --include-optional)  INCLUDE_OPTIONAL=1 ;;
    --forget-receipts)   FORGET_RECEIPTS=1 ;;
    --delete-cert)       DELETE_CERT=1 ;;
    --keep-cert)         KEEP_CERT=1 ;;
    --status)            STATUS_ONLY=1; DRY_RUN=1 ;;
    -h|--help|help)      usage; exit 0 ;;
    *)
      printf '未知参数: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# ---------------------------------------------------------------- 提权（只提一次）
if [ "${YUNSHU_UNINSTALL_ELEVATED:-0}" != "1" ] && [ "$(id -u)" -ne 0 ]; then
  printf '需要管理员权限（/Library、/opt、/Applications 等目录只有 root 可写）。\n正在请求 sudo…\n'
  exec sudo -E env \
    YUNSHU_UNINSTALL_ELEVATED=1 \
    YUNSHU_CALLER_USER="$(id -un)" \
    YUNSHU_CALLER_HOME="$HOME" \
    /bin/bash "$SELF_PATH" "$@"
fi

# 真实用户（sudo 之后 $HOME 变成 /var/root，必须还原，否则 ~ 路径会全错）
if [ -n "${YUNSHU_CALLER_USER:-}" ]; then
  REAL_USER="$YUNSHU_CALLER_USER"
else
  REAL_USER="${SUDO_USER:-$(id -un)}"
fi
REAL_HOME="${YUNSHU_CALLER_HOME:-}"
if [ -z "$REAL_HOME" ] || [ ! -d "$REAL_HOME" ]; then
  REAL_HOME="$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
fi
if [ -z "$REAL_HOME" ] || [ ! -d "$REAL_HOME" ]; then
  REAL_HOME="$(eval echo "~$REAL_USER" 2>/dev/null)"
fi
if [ -z "$REAL_HOME" ] || [ ! -d "$REAL_HOME" ]; then
  printf '无法确定用户 %s 的家目录，中止。\n' "$REAL_USER" >&2
  exit 1
fi
REAL_UID="$(id -u "$REAL_USER" 2>/dev/null || echo 501)"

# ---------------------------------------------------------------- 颜色
if [ -t 1 ]; then
  C_B=$'\033[1m'; C_D=$'\033[0m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_C=$'\033[36m'
else
  C_B=""; C_D=""; C_G=""; C_Y=""; C_R=""; C_C=""
fi

LOGFILE=""
log() {
  printf '%s\n' "$*"
  if [ -n "$LOGFILE" ]; then
    printf '%s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOGFILE" 2>/dev/null
  fi
  return 0
}
hdr() { printf '\n%s── %s%s\n' "$C_B" "$*" "$C_D"; }
ok()  { printf '  %s[✓]%s %s\n' "$C_G" "$C_D" "$*"; }
bad() { printf '  %s[✗]%s %s\n' "$C_R" "$C_D" "$*"; }
dim() { printf '  %s[–]%s %s\n' "$C_Y" "$C_D" "$*"; }

# ---------------------------------------------------------------- 目标清单
TARGETS=(
  "/Applications/Yunshu.app"
  "/Library/Application Support/Yunshu"
  "/opt/.yunshu"
  "/Library/LaunchAgents/com.eagleyun.endpoint.agent.plist"
  "/Library/LaunchDaemons/com.eagleyun.sase.helper.plist"
  "/Library/LaunchDaemons/com.eagleyun.sase.servicemanager.plist"
  "/Library/PrivilegedHelperTools/com.eagleyun.sase.helper"
  "/Library/Logs/com.eagleyun.sase.helper"
  "$REAL_HOME/Library/Logs/com.eagleyun.sase"
  "/Library/Logs/DiagnosticReports/*Yunshu*"
  "/Library/Logs/DiagnosticReports/*eagleyun*"
  "$REAL_HOME/Library/Preferences/com.eagleyun.sase.plist"
  "$REAL_HOME/Library/Preferences/com.eagleyun.endpoint.agent.plist"
  "$REAL_HOME/Library/Application Support/EagleCloud"
  "/Library/Application Support/EagleCloud"
  "$REAL_HOME/Library/Caches/com.eagleyun.endpoint.agent"
  "/opt/yunshu"
  "$REAL_HOME/Library/HTTPStorages/com.eagleyun.sase"
  "$REAL_HOME/Library/HTTPStorages/com.eagleyun.endpoint.agent"
  "$REAL_HOME/Library/WebKit/com.eagleyun.sase"
  "/tmp/tbmdmexecutor-ipc-*"
)

OPTIONAL_TARGETS=(
  "$REAL_HOME/Library/Logs/DiagnosticReports/*Yunshu*"
  "$REAL_HOME/Library/Logs/DiagnosticReports/*eagleyun*"
)

# launchd 里需要 bootout 的服务（先摘服务，再删 plist）
ROOT_JOBS=(
  "com.eagleyun.sase.helper"
  "com.eagleyun.sase.servicemanager"
)
USER_JOBS=(
  "com.eagleyun.endpoint.agent"
)

# ---------------------------------------------------------------- 工具函数
has_glob() {
  case "$1" in
    *[\*\?\[]*) return 0 ;;
    *) return 1 ;;
  esac
}

# 展开一个目标（字面量或通配符），逐行输出命中的绝对路径
resolve_hits() {
  local p="$1"
  if has_glob "$p"; then
    compgen -G "$p" 2>/dev/null || true
  elif [ -e "$p" ] || [ -L "$p" ]; then
    printf '%s\n' "$p"
  fi
}

# 绝不允许被删掉的锚点（清单里某个目标被误写成锚点、或路径被改坏时的最后一道闸）
# 注意：只钉「容器目录本身」，它们的子项照常可删，否则 /Library/Logs/xxx 这类目标永远删不掉。
is_protected() {
  local p="$1"
  case "$p" in
    ''|/|.) return 0 ;;
    *..*) return 0 ;;
    /*) ;;
    *) return 0 ;;   # 非绝对路径一律不删
  esac
  # 顶层系统目录本身
  case "$p" in
    /Applications|/Library|/System|/usr|/bin|/sbin|/etc|/var|/private|/dev|/Users) return 0 ;;
    /opt|/tmp|/var/tmp|/Volumes|/cores) return 0 ;;
  esac
  # 系统的关键容器目录本身（子项不在此列）
  case "$p" in
    /Library/LaunchAgents|/Library/LaunchDaemons|/Library/Logs) return 0 ;;
    /Library/Preferences|/Library/PrivilegedHelperTools) return 0 ;;
    "/Library/Application Support"|/Library/Logs/DiagnosticReports) return 0 ;;
  esac
  # 深层系统树
  case "$p" in
    /System/*|/usr/*|/bin/*|/sbin/*|/dev/*|/Volumes/*|/cores/*|/etc/*) return 0 ;;
  esac
  # 家目录本身、~/Library 本身及其关键容器本身
  case "$p" in
    "$REAL_HOME"|"$REAL_HOME/"|"$REAL_HOME/Library"|"$REAL_HOME/Library/") return 0 ;;
    "$REAL_HOME/Library/Preferences"|"$REAL_HOME/Library/Logs") return 0 ;;
    "$REAL_HOME/Library/HTTPStorages"|"$REAL_HOME/Library/WebKit") return 0 ;;
    "$REAL_HOME/Library/Application Support") return 0 ;;
  esac
  return 1
}

kb_of() { # 输出 KB 数（失败给 0）
  local kb
  kb="$(du -sk "$1" 2>/dev/null | awk '{print $1}')"
  case "$kb" in
    ''|*[!0-9]*) printf '0\n' ;;
    *) printf '%s\n' "$kb" ;;
  esac
}

fmt_size() {
  awk -v kb="${1:-0}" 'BEGIN{
    if (kb >= 1048576)      printf "%.1f GB", kb/1048576;
    else if (kb >= 1024)    printf "%.1f MB", kb/1024;
    else                    printf "%d KB", kb;
  }'
}

kind_of() {
  if [ -L "$1" ]; then printf '链接'
  elif [ -d "$1" ]; then printf '目录'
  else printf '文件'; fi
}

# ---------------------------------------------------------------- 钥匙串证书
# EagleCloud Root CA（别名 sase@eagleyun.com），可能落在登录钥匙串或系统钥匙串
CERT_CN="EagleCloud Root CA"
CERT_ALT="EagleCloud 802.1x"
CERT_EMAIL="sase@eagleyun.com"
CERT_SHA256="3192903784B99E65DAB7FCFD00EEAB4218BE2E242BED201111DE637945ECD448"
CERT_SHA256_FMT="31:92:90:37:84:B9:9E:65:DA:B7:FC:FD:00:EE:AB:42:18:BE:2E:24:2B:ED:20:11:11:DE:63:79:45:EC:D4:48"

colonize() { printf '%s' "$1" | sed 's/\(..\)/\1:/g; s/:$//'; }

# 注意：脚本开了 pipefail，`printf | grep -q` 会因为 grep 提前退出让 printf 吃 SIGPIPE，
# 整条管道被判失败。这类判断一律用 bash 自带 =~，不走管道。
matches() { local text="$1" re="$2"; [[ "$text" =~ $re ]]; }

# 依次尝试：真实用户上下文 → root 直接删 → 按 CN 删；成功返回 0
try_delete_cert() {
  local kc="$1" sha1="$2" out=""
  if [ "$kc" != "/Library/Keychains/System.keychain" ]; then
    out="$(launchctl asuser "$REAL_UID" sudo -u "$REAL_USER" security delete-certificate -Z "$sha1" "$kc" 2>&1)"
    if [ -z "$out" ] || matches "$out" '^[0-9A-Fa-f]{40}$'; then return 0; fi
    dim "  （用户上下文删除未成功，改用 root 直连：$(printf '%s' "$out" | head -1)）"
  fi
  out="$(security delete-certificate -Z "$sha1" "$kc" 2>&1)"
  if [ -z "$out" ] || matches "$out" '^[0-9A-Fa-f]{40}$'; then return 0; fi
  out="$(security delete-certificate -c "$CERT_CN" "$kc" 2>&1)"
  if [ -z "$out" ] || matches "$out" '^[0-9A-Fa-f]{40}$'; then return 0; fi
  printf '%s\n' "$(printf '%s' "$out" | head -2 | tr '\n' ' ')" >&2
  return 1
}

print_cert_howto() {
  printf '  %s手动删除（图形界面，最稳）：%s\n' "$C_B" "$C_D"
  printf '    1. open -a "Keychain Access"\n'
  printf '    2. 左侧选「登录」(login)；若系统钥匙串里也有，再切「系统」(System)\n'
  printf '    3. 类别选「证书」，搜索框输入 EagleCloud 或 sase@eagleyun\n'
  printf '    4. 删之前右键「显示简介」核对 SHA-256：\n'
  printf '       %s%s%s\n' "$C_C" "$CERT_SHA256_FMT" "$C_D"
  printf '    5. 右键「删除"EagleCloud Root CA"」→ 输入登录密码\n'
  printf '  %s别顺手删其它证书；这张删掉只影响对云枢/SASE 流量的信任。%s\n' "$C_Y" "$C_D"
}

# 收集待查钥匙串
collect_keychains() {
  KCS=()
  [ -f "$REAL_HOME/Library/Keychains/login.keychain-db" ] && KCS[${#KCS[@]}]="$REAL_HOME/Library/Keychains/login.keychain-db"
  [ -f "/Library/Keychains/System.keychain" ] && KCS[${#KCS[@]}]="/Library/Keychains/System.keychain"
}

# 在单个钥匙串里找 EagleCloud / eagleyun 证书（按 CN、别名、邮箱三条路查，再按指纹去重）
scan_keychain_certs() {
  local kc="$1" pat dir f subj fp sha1 i dup
  dir="$TMPCERT/$(basename "$kc")"
  mkdir -p "$dir" 2>/dev/null || return 0
  : >"$dir/all.pem"
  for pat in "$CERT_CN" "$CERT_ALT"; do
    security find-certificate -a -c "$pat" -p "$kc" >>"$dir/all.pem" 2>/dev/null
  done
  security find-certificate -a -e "$CERT_EMAIL" -p "$kc" >>"$dir/all.pem" 2>/dev/null
  [ -s "$dir/all.pem" ] || return 0

  awk -v d="$dir" 'BEGIN{n=0; f=""}
    /-----BEGIN CERTIFICATE-----/ { n++; f = sprintf("%s/c%03d.pem", d, n) }
    { if (f != "") print > f }
    /-----END CERTIFICATE-----/ { if (f != "") { close(f); f = "" } }' "$dir/all.pem"

  for f in "$dir"/c*.pem; do
    [ -f "$f" ] || continue
    subj="$(openssl x509 -in "$f" -noout -subject 2>/dev/null)"
    fp="$(openssl x509 -in "$f" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F')"
    # 只认「名字里带 EagleCloud/eagleyun」或「指纹与已知完全一致」的，其余一律忽略
    case "$subj" in
      *EagleCloud*|*eagleyun*) ;;
      *) [ "$fp" = "$CERT_SHA256" ] || { rm -f "$f"; continue; } ;;
    esac
    dup=0
    i=0
    while [ "$i" -lt "${#FOUND_FP[@]}" ]; do
      [ "${FOUND_FP[$i]}" = "$fp" ] && dup=1
      i=$((i + 1))
    done
    [ "$dup" -eq 1 ] && { rm -f "$f"; continue; }
    sha1="$(openssl x509 -in "$f" -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F')"
    FOUND_KC[${#FOUND_KC[@]}]="$kc"
    FOUND_SUBJ[${#FOUND_SUBJ[@]}]="$(printf '%s' "$subj" | sed 's/^subject=//')"
    FOUND_FP[${#FOUND_FP[@]}]="$fp"
    FOUND_SHA1[${#FOUND_SHA1[@]}]="$sha1"
    rm -f "$f"
  done
}

# 扫描全部钥匙串，结果填进 FOUND_* 全局数组
cert_detect() {
  FOUND_KC=(); FOUND_SUBJ=(); FOUND_FP=(); FOUND_SHA1=()
  TMPCERT="$(mktemp -d /tmp/yunshu-cert.XXXXXX 2>/dev/null)"
  collect_keychains
  for kc in "${KCS[@]}"; do scan_keychain_certs "$kc"; done
}

cert_print_found() {
  local i=0
  while [ "$i" -lt "${#FOUND_KC[@]}" ]; do
    printf '\n  找到证书 #%d\n' $((i + 1))
    printf '    钥匙串 : %s\n' "${FOUND_KC[$i]}"
    printf '    Subject: %s\n' "${FOUND_SUBJ[$i]}"
    printf '    SHA-256: %s\n' "$(colonize "${FOUND_FP[$i]}")"
    if [ "${FOUND_FP[$i]}" = "$CERT_SHA256" ]; then
      printf '    %s指纹与已知值一致（2025-07-01 → 2035-06-29 那张）%s\n' "$C_G" "$C_D"
    else
      printf '    %s指纹与已知值不一致——可能是另一张同名证书，脚本不会自动删%s\n' "$C_Y" "$C_D"
    fi
    i=$((i + 1))
  done
}

cert_print_none() {
  ok '两个钥匙串里都没有 EagleCloud / eagleyun 证书——这一项已经是干净的'
  # 证书没了但库里可能还留着非证书 blob（802.1x / trust 记录），说明一下以免误会
  local sys_hits=""
  [ -f "/Library/Keychains/System.keychain" ] && \
    sys_hits="$(strings "/Library/Keychains/System.keychain" 2>/dev/null | grep -i -E 'eaglecloud|eagleyun' || true)"
  if [ -n "$sys_hits" ]; then
    dim '（System.keychain 里仍有 EagleCloud/eagleyun 字样，属于 802.1x/信任记录等非证书数据，'
    dim '  二进制已不在、不提供任何信任能力；不建议手改系统钥匙串，重装或系统清理后会消失）'
  fi
}


# =============================================================================
# PHASE 1 — 扫描并打印清单
# =============================================================================
SE_LINES=""
RECEIPTS=""

printf '%s云枢 / eagleyun SASE 客户端卸载脚本 v%s%s\n' "$C_B" "$SCRIPT_VERSION" "$C_D"
printf '真实用户: %s   家目录: %s   模式: %s\n' \
  "$REAL_USER" "$REAL_HOME" \
  "$( if [ "$PURGE" -eq 1 ]; then echo '永久删除'; else echo '移入废纸篓'; fi )"

hdr "扫描目标清单"

HIT_PATHS=(); HIT_KB=(); HIT_KIND=()
MISSING=()
TOTAL_KB=0

scan_pattern() {
  local pattern="$1" found=0 hit kb
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    found=1
    if is_protected "$hit"; then
      bad "保护路径，跳过: $hit"
      continue
    fi
    kb="$(kb_of "$hit")"
    HIT_PATHS[${#HIT_PATHS[@]}]="$hit"
    HIT_KB[${#HIT_KB[@]}]="$kb"
    HIT_KIND[${#HIT_KIND[@]}]="$(kind_of "$hit")"
    TOTAL_KB=$((TOTAL_KB + kb))
  done < <(resolve_hits "$pattern")
  if [ "$found" -eq 0 ]; then
    MISSING[${#MISSING[@]}]="$pattern"
  fi
}

for t in "${TARGETS[@]}"; do scan_pattern "$t"; done
if [ "$INCLUDE_OPTIONAL" -eq 1 ]; then
  for t in "${OPTIONAL_TARGETS[@]}"; do scan_pattern "$t"; done
fi

SKIP_FILES=0
if [ "${#HIT_PATHS[@]}" -eq 0 ]; then
  SKIP_FILES=1
  printf '\n%s没有匹配到任何文件/目录%s——文件层面已是干净的（或路径与清单不一致）。\n' "$C_G" "$C_D"
  if [ "${#MISSING[@]}" -gt 0 ]; then
    printf '\n未命中的清单项（共 %d 条）:\n' "${#MISSING[@]}"
    for m in "${MISSING[@]}"; do dim "$m"; done
  fi
  printf '\n继续检查钥匙串证书…\n'
fi

if [ "$SKIP_FILES" -eq 0 ]; then
printf '\n找到 %d 项（合计约 %s）:\n\n' "${#HIT_PATHS[@]}" "$(fmt_size "$TOTAL_KB")"
i=0
while [ "$i" -lt "${#HIT_PATHS[@]}" ]; do
  printf '  %s%2d.%s %-9s %-6s %s\n' \
    "$C_C" $((i + 1)) "$C_D" \
    "$(fmt_size "${HIT_KB[$i]}")" "${HIT_KIND[$i]}" "${HIT_PATHS[$i]}"
  i=$((i + 1))
done
fi

printf '\n%s清单里不存在、本次会跳过的项 (%d 条):%s\n' "$C_Y" "${#MISSING[@]}" "$C_D"
if [ "${#MISSING[@]}" -gt 0 ]; then
  for m in "${MISSING[@]}"; do dim "$m"; done
else
  dim '(无)'
fi
if [ "$(id -u)" -ne 0 ]; then
  printf '\n%s提示：当前不是 root，/Library 下部分路径无法读取，会被误列为「不存在」。\n真正运行（sudo）时的清单才是准确的。%s\n' "$C_Y" "$C_D"
fi

# 引擎自带隔离区里可能装着被客户端拦截下来的用户文件——非空时提醒一句
TYPED_CONFIRM=0
[ "$PURGE" -eq 1 ] && TYPED_CONFIRM=1
Q_DIR="/opt/yunshu/quarantine"
Q_FILES=0
if [ -d "$Q_DIR" ]; then
  Q_FILES="$(find "$Q_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
  case "$Q_FILES" in ''|*[!0-9]*) Q_FILES=0 ;; esac
fi
if [ "$Q_FILES" -gt 0 ]; then
  printf '\n%s⚠ %s 里有 %s 个文件%s\n' "$C_Y" "$Q_DIR" "$Q_FILES" "$C_D"
  printf '  那是客户端拦截并隔离下来的内容，会一起进废纸篓；清倒前可以先取回。\n'
  printf '  想先确认内容：%sopen "%s"%s\n' "$C_C" "$Q_DIR" "$C_D"
fi

# 顺带报告正在运行的进程与已安装收据（只读）
hdr "运行中的相关进程"
RUN_PIDS=""
for pat in 'Yunshu\.app/Contents/MacOS' 'com\.eagleyun'; do
  p="$(pgrep -f "$pat" 2>/dev/null | tr '\n' ' ')"
  [ -n "$p" ] && RUN_PIDS="$RUN_PIDS $p"
done
RUN_PIDS="$(printf '%s\n' $RUN_PIDS | grep -v -x -e "$$" -e "$PPID" | sort -u | tr '\n' ' ')"
if [ -n "${RUN_PIDS// /}" ]; then
  for pid in $RUN_PIDS; do
    printf '  PID %-7s %s\n' "$pid" "$(ps -o comm= -p "$pid" 2>/dev/null)"
  done
else
  dim '(没有在运行)'
fi

if command -v systemextensionsctl >/dev/null 2>&1; then
  SE_LINES="$(systemextensionsctl list 2>/dev/null | grep -i -E 'eagleyun|yunshu|eaglecloud' || true)"
  hdr "系统扩展（systemextensionsctl）"
  if [ -n "$SE_LINES" ]; then
    printf '%s\n' "$SE_LINES" | sed 's/^/  /'
    dim '系统扩展只能在 App 内卸载，或重启进恢复模式处理；本脚本只删文件。'
  else
    dim '(没有匹配项)'
  fi
fi

if command -v pkgutil >/dev/null 2>&1; then
  RECEIPTS="$(pkgutil --pkgs 2>/dev/null | grep -i -E 'eagleyun|yunshu|eaglecloud' || true)"
  hdr "安装包收据（pkgutil）"
  if [ -n "$RECEIPTS" ]; then
    printf '%s\n' "$RECEIPTS" | sed 's/^/  /'
    if [ "$FORGET_RECEIPTS" -eq 0 ]; then
      dim '加 --forget-receipts 可一并 forget（删掉安装记录）'
    fi
  else
    dim '(没有匹配项)'
  fi
fi

if [ "$STATUS_ONLY" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then
  hdr "钥匙串证书"
  if [ "$KEEP_CERT" -eq 1 ]; then
    dim '已指定 --keep-cert，跳过钥匙串检查'
  else
    cert_detect
    if [ "${#FOUND_KC[@]}" -eq 0 ]; then
      cert_print_none
    else
      cert_print_found
      dim '（正式运行时脚本会问你是否删除；非交互加 --delete-cert）'
    fi
    [ -n "${TMPCERT:-}" ] && rm -rf "$TMPCERT" 2>/dev/null
  fi
  printf '\n%s--dry-run / --status：到此为止，未做任何改动。%s\n' "$C_G" "$C_D"
  exit 0
fi

# =============================================================================
# PHASE 2 — 二次确认
# =============================================================================
TRASH_DIR="$REAL_HOME/.Trash"
LOGFILE="/tmp/yunshu-uninstall-$(date '+%Y%m%d-%H%M%S').log"
log "===== $(date '+%Y-%m-%d %H:%M:%S') 开始卸载 v$SCRIPT_VERSION（purge=$PURGE，skip_files=$SKIP_FILES）====="

if [ "$SKIP_FILES" -eq 0 ]; then   
hdr "确认"
if [ "$PURGE" -eq 1 ]; then
  printf '  模式：%s永久删除（rm -rf，不进废纸篓，不可恢复）%s\n' "$C_R" "$C_D"
else
  printf '  模式：移入废纸篓  %s%s%s\n' "$C_C" "$TRASH_DIR" "$C_D"
  printf '  Finder 侧栏「废纸篓」里可见、能拖回原处；清倒废纸篓才是彻底删除。\n'
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  # 优先读终端；没有可用终端时退回 stdin（便于 `echo DELETE | ...` 这类场景）
  TTY_OK=0
  if ( : </dev/tty ) 2>/dev/null; then TTY_OK=1; fi
  ans=""
  if [ "$TYPED_CONFIRM" -eq 1 ]; then
    printf '\n永久删除不可恢复。确认请输入 %sDELETE%s：' "$C_R" "$C_D"
  else
    printf '\n确认继续？[y/N] '
  fi
  if [ "$TTY_OK" -eq 1 ]; then
    read -r ans < /dev/tty || ans=""
  else
    read -r ans || ans=""
  fi
  ans_lc="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  if [ "$TYPED_CONFIRM" -eq 1 ]; then
    [ "$ans_lc" = "delete" ] || { printf '\n已取消，未做任何改动。\n'; exit 1; }
  else
    case "$ans_lc" in
      y|yes) ;;
      *) printf '\n已取消，未做任何改动。\n'; exit 1 ;;
    esac
  fi
fi

# 废纸篓准备（不存在就建；不用 sudo 建，否则属主不对）
if [ "$PURGE" -eq 0 ]; then
  if [ ! -d "$TRASH_DIR" ]; then
    if ! mkdir -p "$TRASH_DIR"; then
      printf '无法创建废纸篓目录 %s，中止。\n' "$TRASH_DIR" >&2
      exit 1
    fi
    chown "$REAL_USER" "$TRASH_DIR" 2>/dev/null || true
  fi
fi

# =============================================================================
# PHASE 3 — 停进程、摘 launchd 服务
# =============================================================================
hdr "停止进程与系统服务"

# 3.0 先礼后兵：让 App 自己退出
if [ -d "/Applications/Yunshu.app" ]; then
  launchctl asuser "$REAL_UID" osascript -e 'tell application "Yunshu" to quit' >/dev/null 2>&1
  ok '已请求 Yunshu 正常退出'
fi

# 3.1 bootout 系统级守护进程
for label in "${ROOT_JOBS[@]}"; do
  out=""
  out="$(launchctl bootout "system/$label" 2>&1)" && ok "已卸载系统服务 $label" || dim "系统服务 $label 未在运行（${out:-no such process}）"
done

# 3.2 bootout 用户级 agent（必须在 gui 域，且以真实用户身份）
for label in "${USER_JOBS[@]}"; do
  out=""
  out="$(launchctl asuser "$REAL_UID" launchctl bootout "gui/$REAL_UID/$label" 2>&1)" \
    && ok "已卸载用户服务 $label" \
    || dim "用户服务 $label 未在运行（${out:-no such process}）"
done

# 3.3 杀掉残留进程（先 TERM，1s 后 KILL）
collect_pids() {
  local pat
  for pat in 'Yunshu\.app/Contents/MacOS' 'com\.eagleyun'; do
    pgrep -f "$pat" 2>/dev/null || true
  done
}
PIDS="$(collect_pids | grep -v -x -e "$$" -e "$PPID" | sort -u | tr '\n' ' ')"
if [ -n "${PIDS// /}" ]; then
  for pid in $PIDS; do
    log "  · 结束进程 PID $pid（$(ps -o comm= -p "$pid" 2>/dev/null)）"
  done
  kill -TERM $PIDS >/dev/null 2>&1
  sleep 1
  PIDS_LEFT="$(collect_pids | grep -v -x -e "$$" -e "$PPID" | sort -u | tr '\n' ' ')"
  if [ -n "${PIDS_LEFT// /}" ]; then
    kill -KILL $PIDS_LEFT >/dev/null 2>&1
    ok '已强制结束残留进程'
  else
    ok '进程已全部退出'
  fi
else
  dim '没有需要结束的进程'
fi

# =============================================================================
# PHASE 4 — 移入废纸篓 / 删除
# =============================================================================
hdr "移除文件"

REMOVED=0
FAILED=0
FAILED_LIST=()

# 废纸篓里重名时追加 " (2)"、" (3)"，绝不覆盖已有条目
unique_name() {
  local base="$1" cand="$1" n=2
  while [ -e "$TRASH_DIR/$cand" ] || [ -L "$TRASH_DIR/$cand" ]; do
    cand="$base ($n)"
    n=$((n + 1))
  done
  printf '%s\n' "$cand"
}

remove_one() {
  local path="$1" base cand dest moved

  if [ "$PURGE" -eq 1 ]; then
    rm -rf -- "$path" 2>/dev/null
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then
      ok "已删除 $path"
      REMOVED=$((REMOVED + 1))
    else
      bad "删除失败 $path（受 SIP / 系统扩展保护，或仍被占用）"
      FAILED=$((FAILED + 1)); FAILED_LIST[${#FAILED_LIST[@]}]="$path"
    fi
    return 0
  fi

  base="$(basename "$path")"
  cand="$(unique_name "$base")"
  dest="$TRASH_DIR/$cand"

  moved=0
  if mv -- "$path" "$dest" 2>/dev/null; then
    moved=1
  elif ditto -- "$path" "$dest" 2>/dev/null && rm -rf -- "$path" 2>/dev/null; then
    moved=1
    dim "（跨卷：复制后删除）"
  fi

  if [ "$moved" -eq 0 ]; then
    bad "移入废纸篓失败 $path"
    FAILED=$((FAILED + 1)); FAILED_LIST[${#FAILED_LIST[@]}]="$path"
    return 0
  fi

  # 交还给真实用户：否则清倒废纸篓时 root 所属条目会清不掉 / 反复要求管理员密码
  chown -R "$REAL_USER" "$dest" 2>/dev/null || true

  if [ "$cand" = "$base" ]; then
    ok "已移入废纸篓 $path"
  else
    ok "已移入废纸篓 $path  →  $cand（重名，已改名）"
  fi
  REMOVED=$((REMOVED + 1))
  # 完整映射只写日志，不刷屏
  printf '%s | TRASHED  %s  ->  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$path" "$dest" >>"$LOGFILE" 2>/dev/null
  return 0
}

i=0
while [ "$i" -lt "${#HIT_PATHS[@]}" ]; do
  remove_one "${HIT_PATHS[$i]}"
  i=$((i + 1))
done

fi   # SKIP_FILES 结束：文件阶段（PHASE 2~4）

# =============================================================================
# PHASE 5 — 钥匙串证书（EagleCloud Root CA）
# =============================================================================
hdr "钥匙串证书"

if [ "$KEEP_CERT" -eq 1 ]; then
  dim '已指定 --keep-cert，跳过钥匙串检查'
else
  cert_detect
  if [ "${#FOUND_KC[@]}" -eq 0 ]; then
    cert_print_none
  else
    cert_print_found
    DO_CERT=0
    if [ "$DELETE_CERT" -eq 1 ]; then
      DO_CERT=1
    elif [ "$ASSUME_YES" -eq 1 ]; then
      printf '\n  %s非交互模式（--yes）默认不动证书；要一起删请加 --delete-cert%s\n' "$C_Y" "$C_D"
    else
      TTY_OK=0
      if ( : </dev/tty ) 2>/dev/null; then TTY_OK=1; fi
      ans=""
      printf '\n  现在删除上述证书？[y/N] '
      if [ "$TTY_OK" -eq 1 ]; then
        read -r ans < /dev/tty || ans=""
      else
        read -r ans || ans=""
      fi
      case "$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')" in
        y|yes) DO_CERT=1 ;;
        *) DO_CERT=0 ;;
      esac
    fi

    if [ "$DO_CERT" -eq 1 ]; then
      i=0
      while [ "$i" -lt "${#FOUND_KC[@]}" ]; do
        kc="${FOUND_KC[$i]}"
        sha1="${FOUND_SHA1[$i]}"
        if [ "${FOUND_FP[$i]}" != "$CERT_SHA256" ]; then
          dim "跳过（指纹不符，请手工核对）: ${FOUND_SUBJ[$i]}"
          i=$((i + 1)); continue
        fi
        if try_delete_cert "$kc" "$sha1"; then
          ok "已删除证书：${FOUND_SUBJ[$i]}  ←  $kc"
          printf '%s | CERT DELETED  %s  sha1=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$kc" "$sha1" >>"$LOGFILE" 2>/dev/null
        else
          bad '自动删除失败（见上面报错）'
          dim '  若钥匙串处于锁定状态，先在「钥匙串访问」里解锁（或 security unlock-keychain）再重跑'
          dim '  也可以按下面步骤手动删'
        fi
        i=$((i + 1))
      done
      cert_detect
      if [ "${#FOUND_KC[@]}" -eq 0 ]; then
        ok '复核通过：钥匙串里已没有该证书'
      else
        dim "复核：仍剩 ${#FOUND_KC[@]} 张，请按下面步骤手动处理"
        print_cert_howto
      fi
    else
      printf '\n'
      print_cert_howto
    fi
  fi
  [ -n "${TMPCERT:-}" ] && rm -rf "$TMPCERT" 2>/dev/null
fi

# =============================================================================
# PHASE 6 — 收尾
# =============================================================================
if [ "$FORGET_RECEIPTS" -eq 1 ]; then
  hdr "forget 安装包收据"
  forgot=0
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    if pkgutil --forget "$r" >/dev/null 2>&1; then
      ok "已 forget $r"; forgot=$((forgot + 1))
    else
      dim "forget 失败（可能本来就不存在） $r"
    fi
  done <<EOF
$RECEIPTS
EOF
  [ "$forgot" -eq 0 ] && dim '没有可 forget 的收据'
fi

# 清掉 LaunchServices 里的旧注册（只针对已不存在的 App 路径，不做全量重建）
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREG" ] && [ ! -d "/Applications/Yunshu.app" ]; then
  dim 'App 已移除；Dock / 启动台里的旧图标重启后会自动消失'
fi

hdr "结果"
if [ "$SKIP_FILES" -eq 1 ]; then
  dim '文件/目录：无可删项（已跳过）'
else
  log "成功 ${REMOVED} 项，失败 ${FAILED} 项"
  if [ "$FAILED" -gt 0 ]; then
    printf '以下条目没能移除（通常是受 SIP / 系统扩展保护，或仍被占用）：\n'
    for f in "${FAILED_LIST[@]}"; do bad "$f"; done
  fi
fi

if [ "$SKIP_FILES" -eq 0 ] && [ "$PURGE" -eq 0 ]; then
  printf '\n已移入废纸篓: %s%s%s\n' "$C_C" "$TRASH_DIR" "$C_D"
  printf '  在 Finder 侧栏「废纸篓」里能直接看到，需要取回就拖回原处。\n'
  printf '  %s注意：Finder 的「放回原处」对脚本移入的条目无效（没有 .DS_Store 记录），只能手动拖。%s\n' "$C_Y" "$C_D"
  printf '  彻底删除：在 Finder 里清倒废纸篓（已把所属权交还给你，不会再要管理员密码）。\n'
fi
printf '\n日志: %s\n' "$LOGFILE"

printf '\n%s建议接下来：%s\n' "$C_B" "$C_D"
printf '  1. 重启一次，让 launchd / 系统扩展彻底释放\n'
printf '  2. 复查残留: %ssudo bash "%s" --status%s\n' "$C_C" "$SELF_PATH" "$C_D"
printf '  3. 若「系统设置 → 通用 → 登录项与扩展」里还有 Yunshu 条目，手动移除\n'
printf '  4. 若 systemextensionsctl 仍列出 eagleyun 扩展，需在「系统设置 → 通用 → 登录项与扩展」\n'
printf '     或重启进恢复模式用 systemextensionsctl uninstall 处理\n'
printf '  5. /Library/Preferences/com.apple.networkextension.plist 里的 com.eagleyun.* 多为历史引用，\n'
printf '     二进制已不在时不提供过滤/隧道能力；属系统文件，不建议手改，可等重启后自愈\n'

log "===== 结束 ====="
exit 0
