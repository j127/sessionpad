#!/bin/bash
#
# Pre-tool-use hook that blocks Bash commands that add AI agent attribution
# (e.g. "Co-Authored-By: Claude", "Generated with Claude Code") to a commit, a
# PR or another Git/GitHub message.
#
# This enforces the AGENTS.md rule:
#   "NEVER commit code that contains AI agent attribution. Do NOT add the agent
#   name (e.g. Claude, Generated with Claude Code, Co-Authored-By Claude)
#   anywhere in commit messages, PR descriptions, or other Git/GitHub
#   messages."
#
# It's one of three layers:
#   1. .claude/settings.json sets "attribution" to empty strings, so Claude
#      Code doesn't add its co-author trailer, PR footer or session link in the
#      first place. That also covers tools this hook doesn't see, such as an
#      MCP server's create-PR tool.
#   2. This hook checks Bash commands that write a git or GitHub message (git
#      commit, commit-tree, merge and notes, and git tag with a message; gh pr
#      and issue create, edit, comment, review, merge, close and reopen; gh
#      release create and edit; gh api when it sends a body; any jj, gt, hub
#      or glab command) for attribution trailers and footers at the start of a
#      message line, both in the command and in the message files it names.
#      It also blocks making the agent a commit author or committer (git
#      commit --author, -c user.name, git config, GIT_AUTHOR_* variables).
#      Other commands pass, so searches that mention the agent (git grep, git
#      log --grep or --author, gh pr list) aren't blocked, and neither is a
#      message that only mentions the agent or quotes a trailer, such as one
#      about this hook.
#   3. .githooks/commit-msg checks the final message, author and committer of
#      each git commit and git merge, whichever tool runs it, so it catches
#      commits this hook can't resolve, such as a message file named by a
#      variable. Enable it once per clone with
#      `git config core.hooksPath .githooks`.
#
# `git commit --no-verify` skips layer 3, and PR, issue and release text that
# this hook can't resolve only has layer 1.

# Match bytes, not characters, so grep, sed and bash's own regex matching
# behave the same in every locale, even on invalid UTF-8. Bash's [[ =~ ]]
# ignores case like grep -i.
export LC_ALL=C
shopt -s nocasematch

# Bash's regex matching has crashed (SIGSEGV) on large patterns like these
# with macOS's regex library, now and then and only on some inputs. A crashed
# hook prints nothing, which lets the command through, so the checks run in a
# child bash, and if it doesn't exit cleanly the command is blocked instead.
if [ -z "$NO_AI_ATTRIBUTION_CHILD" ]; then
  OUTPUT=$(NO_AI_ATTRIBUTION_CHILD=1 "$BASH" "$0")
  STATUS=$?

  if [ "$STATUS" -ne 0 ]; then
    printf '%s\n' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "BLOCKED: the no-ai-attribution hook failed (exit status '"$STATUS"') while checking this command, so it cannot tell whether the command adds AI agent attribution. Run the command again. If this keeps happening, check .claude/hooks/no-ai-attribution.sh."}}'
  elif [ -n "$OUTPUT" ]; then
    printf '%s\n' "$OUTPUT"
  fi
  exit 0
fi

INPUT=$(cat)

# BEGIN attribution patterns
# .claude/hooks/no-ai-attribution.sh and .githooks/commit-msg share this
# block. Keep the two copies identical.
#
# The agent's name: Claude alone or with a product or model name, such as
# Claude Code, Claude Opus 4.5, claude-3-5-sonnet or claude[bot], optionally in
# markdown emphasis, a code span or a link. The name has to end there, so a
# person whose name only starts with Claude (Claude Dupont, Claude-Michel)
# doesn't match, but a bare "Claude" does, since that's how the agent signs.
AGENT_NAME='[[*_`]*(anthropic[ -])?claude([ -]?(code|opus|sonnet|haiku|fable|instant|ai|agent|assistant|bot|v?[0-9][0-9.]*)|\[bot\])*[]*_`]*'
# After the name comes the end of the line or a character such as < or ".
# A hyphen, comma, closing parenthesis or possessive 's doesn't count, since
# the name or sentence goes on (Claude-Michel, Claude's settings, a quote of
# the AGENTS.md rule). A comma does count when words and then "by" or "with"
# follow it, as in a footer that goes on with ", reviewed by Jane Doe". A
# hard-wrapped quote of the rule can start a line with its example footer and
# a comma, but then the line ends or the rule's next example follows, and
# "Co-Authored-By" doesn't match, since its words are joined by hyphens.
AGENT_END='[[:space:]]*([^-,)'\''[:alnum:][:space:]]|'\''([^[:alnum:]]|$)|,[[:space:]]*([[:alpha:]]+[[:space:]]+)*(by|with)([^[:alnum:]]|$)|$)'
# The agent's noreply address, which its co-author trailer uses.
AGENT_EMAIL='noreply@anthropic\.com'
# What can come before a trailer or footer on its line: bullets, emoji and
# HTML tags such as <sub>. Quotes, backticks and > can't, so a trailer quoted
# in a sentence, a code span or a blockquote is fine.
LEAD='([^[:alnum:]"'\''`>]|<[[:alpha:]]+>)*'
# Verbs that credit an author, as in "Generated with" or "Written by".
CREDIT='(generated|created|made|written|built|authored|co-authored|produced|assisted|drafted|developed|coded|implemented)'
# Trailers that credit the agent: Co-Authored-By and variants such as
# "Co-authored by", any other *-by key (Assisted-by, Signed-off-by) and
# credit *-with keys (Generated-with) naming the agent or its address, and the
# Claude-Session link trailer.
TRAILER="$LEAD((co-?authored[ -]?by|[a-z]+(-[a-z]+)*-by|$CREDIT-with)[[:space:]]*[:=]?[[:space:]]*($AGENT_NAME$AGENT_END|[^\"'<]*<?$AGENT_EMAIL)|claude-session[[:space:]]*:)"
# Footers such as "Generated with Claude Code" or "Written by: Claude".
FOOTER="$LEAD$CREDIT[[:space:]]+((with|by|using|via|alongside)[[:space:]]*:?|in[[:space:]]+collaboration[[:space:]]+with)[[:space:]]+((the[[:space:]]+)?(help|assistance)[[:space:]]+(of|from)[[:space:]]+)?$AGENT_NAME$AGENT_END"
# A sed command that drops fenced code blocks, since an example in one isn't
# attribution.
CODE_BLOCKS='/^[[:space:]]*```/,/^[[:space:]]*```/d'
# END attribution patterns

# A backslash escape or a quoted string, as the shell reads them: \x,
# "..." with \" and \\ escapes inside, or '...'.
QUOTED='\\.|"(\\.|[^\\"])*"|'\''[^'\'']*'\'''
# A command's arguments, up to a |, ; or & that ends it. Either quotes pair up
# strictly, so a quoted string can hold those characters (git -C "a & b"
# commit, git -c 'x=a;b' commit), or quotes are ordinary characters, as in the
# plain [^|;&]* this replaced, so a lone quote still matches. A lone or
# escaped quote can't take part in the pairing, or quotes from two commands
# would pair up across the && between them (git commit -m "x" && git log
# --format="%an", git commit -m don\'t && git log --grep=won\'t). A quote
# inside $'...' can still pair that way, which only makes the hook check a
# command it didn't need to.
ARGS='(([^\\|;&"'\'']|'"$QUOTED"')*|[^|;&]*)'
# Commands that write a git or GitHub message (see the header). Global options
# such as -C <dir> can come between git and its subcommand.
GIT_WRITE='(^|[^[:alnum:]_.-])git[[:space:]]('"$ARGS"'[[:space:]])?((commit|commit-tree|merge|notes)([^[:alnum:]_-]|$)|tag[[:space:]]('"$ARGS"'[[:space:]])?(-[[:alpha:]]*[amsF]|--annotate|--sign|--message|--file)([^[:alnum:]_-]|$))'
GH_WRITE='(^|[^[:alnum:]_.-])gh[[:space:]]('"$ARGS"'[[:space:]])?((pr|issue)[[:space:]]+(create|edit|comment|review|merge|close|reopen)|release[[:space:]]+(create|edit))([^[:alnum:]_-]|$)'
GH_API_WRITE='(^|[^[:alnum:]_.-])gh[[:space:]]('"$ARGS"'[[:space:]])?api[[:space:]]('"$ARGS"'[[:space:]])?(-f|--field|--raw-field|--input|(-X|--method)(=|[[:space:]]*)(post|patch|put))([^[:alnum:]_-]|$)'
GH_API_GET='(^|[^[:alnum:]_.-])gh[[:space:]]([^|;&]*[[:space:]])?api[[:space:]]([^|;&]*[[:space:]])?(-X|--method)(=|[[:space:]]*)get([^[:alnum:]_-]|$)'
OTHER_WRITE='(^|[^[:alnum:]_.-])(jj|gt|hub|glab)[[:space:]]'
GIT_ANY='(^|[^[:alnum:]_.-])git[[:space:]]'

# Where a message line can start in a command: at the start of a line (as in a
# heredoc), after a literal \n (as in -m $'...\n...'), or at the start of the
# value of a message option (-m, --message, --trailer, -b/--body, -t/--title,
# --subject, --notes, --comment, --description), a gh api field
# (-f/-F key=...) or a shell variable (MSG=...). Other quoted text, such as a
# search pattern or a quote inside a message, doesn't count.
QUOTE='(\$?["'\''])?'
LINE_START='(^|\\n|[[:space:]](-[[:alpha:]]*m|--message|--trailer|-b|--body|-t|--title|--subject|--notes|--comment|--description)(=|[[:space:]]*)'"$QUOTE"'|[[:space:]](-f|-F|--field|--raw-field)[[:space:]]*[^=[:space:]]+='"$QUOTE"'|(^|[[:space:];&|(])[[:alpha:]_][[:alnum:]_]*='"$QUOTE"')'

# A file name in a command, which can be quoted.
FILE_NAME='("[^"]*"|'\''[^'\'']*'\''|[^[:space:]"'\'';&|<>()]+)'
# Where a command reads a message from a file: -F/--file (git), -F/--body-file
# (gh pr and issue), --notes-file (gh release), -F/--field key=@file (gh api),
# $(cat file), $(<file) and <file. The file name is group 8.
MESSAGE_FILE='((^|[[:space:]])(-F[[:space:]]*|(--file|--body-file|--notes-file|--field)(=|[[:space:]]+))|\$\((cat[[:space:]]+|<[[:space:]]*)|(^|[[:space:]])<[[:space:]]*)'"$FILE_NAME"
# A `cd <dir> &&` or `cd <dir>;` at the start of the command.
LEADING_CD='^[[:space:]]*cd[[:space:]]+'"$FILE_NAME"'[[:space:]]*(&&|;)'
# A shell word, which can be partly quoted.
WORD='([^[:space:]"'\'';&|<>()]|"[^"]*"|'\''[^'\'']*'\'')+'
# git and the arguments that follow it. The arguments are group 2.
GIT_ARGS='(^|[^[:alnum:]_.-])git([[:space:]].*)$'
# What ends a command, so the text after the last of these is the command a
# message file option belongs to.
COMMAND_END=$';&|()`\n'
# The text after the last COMMAND_END character. A regex finds it in linear
# time, while ${var##*[...]} takes quadratic time on a long command.
SEGMENT="[^$COMMAND_END]*\$"
# An awk program that prints the text after the last COMMAND_END character
# outside quotes, so git -C "repo (old)" stays in its command. It splits the
# text into characters once, since length() and substr() on a long string
# take linear time each in macOS awk, which would make the loop quadratic.
QUOTED_SEGMENT='
  BEGIN { RS = "\001"; sq = sprintf("%c", 39); ends = ";&|()`\n" }
  {
    quote = ""
    start = 1
    n = split($0, ch, "")
    for (i = 1; i <= n; i++) {
      c = ch[i]
      if (quote == sq) { if (c == sq) quote = ""; continue }
      if (c == "\\") { i++; continue }
      if (quote != "") { if (c == quote) quote = ""; continue }
      if (c == sq || c == "\"") quote = c
      else if (index(ends, c)) start = i + 1
    }
    printf "%s", substr($0, start)
  }
'

# The agent as the value of an identity option or variable, quoted or not:
# "Claude <...>", "Claude (AI) <...>", Claude, or anything with the agent's
# noreply address.
AGENT_VALUE='(["'\''][[:space:]]*'"$AGENT_NAME"'[[:space:]]*(\([^)]*\)[[:space:]]*)?(<|["'\''])|'"$AGENT_NAME"'([[:space:];&|)]|$)|(["'\''][^"'\'']*|[^"'\''[:space:]]*)'"$AGENT_EMAIL"')'
# --author in the same git commit call: git, its global options, commit, then
# arguments up to the end of that command. git log --author only searches.
# Like ARGS, each part either pairs quotes strictly, so a global option's
# value can hold spaces (git -C "my repo" commit) and the arguments can hold
# |, ; and &, or treats quotes as ordinary characters, as before.
GLOBAL_OPTION='-([^[:space:]]+|([^[:space:]\\"'\'']|'"$QUOTED"')+)'
GLOBAL_VALUE='([^-[:space:]][^[:space:]]*|([^-[:space:]\\"'\'']|'"$QUOTED"')([^[:space:]\\"'\'']|'"$QUOTED"')*)'
AUTHOR_OPTION='(^|[^[:alnum:]_.-])git([[:space:]]+'"$GLOBAL_OPTION"'([[:space:]]+'"$GLOBAL_VALUE"')?)*[[:space:]]+commit[[:space:]]((([^\\|;&"'\'''$'\n'']|'"$QUOTED"')*|[^|;&'$'\n'']*)[[:space:]])?--author(=|[[:space:]]+)'
# git config that sets user.name or user.email, as opposed to --get, --unset
# and other options that read or remove it.
CONFIG_USER='[[:space:]]config([[:space:]]+(--global|--local|--system|--worktree|--add|--replace-all|set|--file[=[:space:]][^[:space:]]+|-f[[:space:]]+[^[:space:]]+))*[[:space:]]+user\.(name|email)[[:space:]]+'
# Ways to make the agent a commit author or committer: --author,
# -c user.name or user.email (quoted or not), git config user.name or
# user.email, and GIT_AUTHOR_*/GIT_COMMITTER_* variables. Each is its own
# pattern, since bash crashed now and then matching all of them as one.
IDENTITY_PATTERNS=(
  "$AUTHOR_OPTION$AGENT_VALUE"
  '-c[[:space:]]*user\.(name|email)='"$AGENT_VALUE"
  "$CONFIG_USER$AGENT_VALUE"
  '(^|[[:space:];&|(])(export[[:space:]]+)?GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)='"$AGENT_VALUE"
  '-c[[:space:]]*["'\'']user\.(name|email)=('"$AGENT_NAME"'[[:space:]]*["'\'']|[^"'\'']*'"$AGENT_EMAIL"')'
)

# Succeeds when the command in $1 writes a git or GitHub message.
writes_message() {
  [[ $1 =~ $GIT_WRITE || $1 =~ $GH_WRITE || $1 =~ $OTHER_WRITE ]] ||
    [[ $1 =~ $GH_API_WRITE && ! $1 =~ $GH_API_GET ]]
}

# Succeeds when the command in $1 makes the agent a commit author or
# committer.
sets_agent_identity() {
  local pattern

  [[ $1 =~ $GIT_ANY ]] || return 1

  for pattern in "${IDENTITY_PATTERNS[@]}"; do
    [[ $1 =~ $pattern ]] && return 0
  done
  return 1
}

# jq parses the hook input. Without it the hook can't read the command
# reliably, so it can't tell a harmless git or gh command from one that adds
# attribution. It pulls the command out of the JSON well enough to spot the
# commands that write a message or set the agent as author, blocks those with
# a note to install jq, and lets every other command through, so a missing jq
# doesn't stop all work (or the install of jq).
JSON_COMMAND='"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)"'

if ! command -v jq >/dev/null 2>&1; then
  if [[ $INPUT =~ $JSON_COMMAND ]]; then
    COMMAND=${BASH_REMATCH[1]}
    # Undo the JSON escapes that matter here: \\, \n, \t and \".
    COMMAND=${COMMAND//\\\\/$'\001'}
    COMMAND=${COMMAND//\\n/$'\n'}
    COMMAND=${COMMAND//\\t/$'\t'}
    COMMAND=${COMMAND//\\\"/\"}
    COMMAND=${COMMAND//$'\001'/\\}

    if writes_message "$COMMAND" || sets_agent_identity "$COMMAND"; then
      printf '%s\n' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "BLOCKED: jq is not installed, so the no-ai-attribution hook cannot check this command for AI agent attribution. Install jq, then try again."}}'
    fi
  fi
  exit 0
fi

RULE='Per AGENTS.md, do NOT add the agent name (e.g. Claude, Generated with Claude Code, Co-Authored-By Claude) anywhere in commit messages, PR descriptions, or other Git/GitHub messages.'

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

if [ -z "$COMMAND" ]; then
  exit 0
fi

deny() {
  jq -n --arg reason "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $reason
    }
  }'
  exit 0
}

# Succeeds when the text on stdin has an attribution trailer or footer where a
# message line starts ($1 is the pattern for that), outside fenced code
# blocks.
has_attribution() {
  sed -e "$CODE_BLOCKS" | grep -Eaiq -e "$1$TRAILER" -e "$1$FOOTER"
}

# Sets DIR to directory $2 resolved against directory $1: ~ and $HOME are
# expanded, and an absolute directory stands on its own. Fails if $2 needs
# other expansions (other variables, command substitutions).
resolve_dir() {
  local dir=$2

  dir=${dir#[\"\']}
  dir=${dir%[\"\']}

  case $dir in
    '') DIR=$1 ;;
    '~' | '$HOME' | '${HOME}') DIR=$HOME ;;
    '~/'* | '$HOME/'* | '${HOME}/'*) DIR=$HOME/${dir#*/} ;;
    *'$'* | *'`'*) return 1 ;;
    /*) DIR=$dir ;;
    *) DIR=$1/$dir ;;
  esac
}

# Sets BASE to the directory that the shell reads relative message files from:
# the session's working directory, or the one a leading `cd <dir> &&` switches
# to.
set_base_dir() {
  BASE=$(jq -r '.cwd // empty' <<<"$INPUT")
  BASE=${BASE:-$PWD}

  if [[ $COMMAND =~ $LEADING_CD ]] && resolve_dir "$BASE" "${BASH_REMATCH[1]}"; then
    BASE=$DIR
  fi
}

# Sets DIR to the directory that the git command in $1 runs in, and so reads
# relative message files from: BASE, changed by each git -C <dir> before the
# subcommand. Each -C is relative to the one before it, and an absolute one
# starts over. Fails if a -C directory needs expansions that resolve_dir
# doesn't do. A command without git gets BASE, since gh has no -C. This only
# looks for "git" in the command, which can also be quoted text, so callers
# check DIR as well as BASE, never instead of it.
git_work_dir() {
  local rest word

  DIR=$BASE
  [[ $1 =~ $GIT_ARGS ]] || return 0
  rest=${BASH_REMATCH[2]}

  # Walk git's global options up to the subcommand. These options take a
  # separate value.
  while [[ $rest =~ ^[[:space:]]+($WORD) ]]; do
    rest=${rest#"${BASH_REMATCH[0]}"}
    word=${BASH_REMATCH[1]}

    case $word in
      -C | -c | --git-dir | --work-tree | --namespace | --super-prefix | --config-env | --attr-source)
        [[ $rest =~ ^[[:space:]]+($WORD) ]] || return 0
        rest=${rest#"${BASH_REMATCH[0]}"}

        if [ "$word" = -C ]; then
          word=${BASH_REMATCH[1]}
          resolve_dir "$DIR" "${word//[\"\']/}" || return 1
        fi
        ;;
      -*) ;;
      *) return 0 ;;
    esac
  done
}

# Denies the command if message file $1 has an attribution trailer or footer.
check_message_file() {
  if [ -f "$1" ] && [ -r "$1" ] && has_attribution '^' <"$1"; then
    deny "BLOCKED: $1 contains AI agent attribution. $RULE Remove the attribution from the file and try again. If an earlier part of this command removes it, run that part on its own first."
  fi
}

# Also checks relative message file $2 where the git command at the end of
# command text $1 reads it after its -C options, when that's not BASE. The
# command can be read two ways: after the last ;, &, |, (, ), backtick or line
# break, or after the last of those outside quotes. A quote in a heredoc can
# throw the second one off, so it's only read when the first has no git, as
# when a quoted ( or ; cut the command short, and both are checked then. That
# also keeps awk's slower scan of the text off most commands.
check_git_dir_file() {
  local plain quoted

  [[ $1 =~ $SEGMENT ]]
  plain=${BASH_REMATCH[0]}

  if git_work_dir "$plain" && [ "$DIR" != "$BASE" ]; then
    check_message_file "$DIR/$2"
  fi

  if [[ ! $plain =~ $GIT_ARGS && $1 == *[\"\']* ]]; then
    quoted=$(printf '%s' "$1" | awk "$QUOTED_SEGMENT")

    if [ "$quoted" != "$plain" ] && git_work_dir "$quoted" && [ "$DIR" != "$BASE" ]; then
      check_message_file "$DIR/$2"
    fi
  fi
}

# Denies the command if a message file it names has an attribution trailer or
# footer. $HOME, $PWD and $TMPDIR are expanded. A relative file is read from
# the session's working directory or a leading cd's directory. For a git
# option such as -F, the file where git's -C options move it is checked too
# (the shell reads <file and $(cat file) itself). Checking both can block a
# command whose other file has attribution, but it never checks less than
# when -C is ignored. Stdin (-) and files the shell would still expand in
# other ways (other variables, globs, command substitutions) are skipped: the
# commit-msg hook still checks those commits (unless --no-verify skips it),
# but PR, issue and release text then only has the attribution setting. Only
# the first 20 files are checked, so a huge command can't stall the hook.
check_message_files() {
  local rest=$COMMAND

  # Join lines that end in a backslash, so a git command split across lines
  # stays one command. awk does it in one pass; ${COMMAND//...} takes time
  # proportional to the number of lines times the length under bash 3.2.
  if [[ $COMMAND == *$'\\\n'* ]]; then
    rest=$(printf '%s\n' "$COMMAND" | awk '{ if (sub(/\\$/, "")) printf "%s ", $0; else print }')
  fi
  local scanned=''
  local count=0
  local match option before file

  BASE=''

  # Option names are case-sensitive here: gh api -f sends @file as text, while
  # -F reads the file, and git's -C isn't its -c.
  shopt -u nocasematch

  while [ "$count" -lt 20 ] && [[ $rest =~ $MESSAGE_FILE ]]; do
    count=$((count + 1))
    match=${BASH_REMATCH[0]}
    option=${BASH_REMATCH[3]}
    file=${BASH_REMATCH[8]}
    before=$scanned${rest%%"$match"*}
    scanned=$before$match
    rest=${rest#*"$match"}
    file=${file#[\"\']}
    file=${file%[\"\']}

    case $file in
      *=@*) file=${file#*=@} ;;
      *=*) continue ;;
    esac

    case $file in
      '~/'* | '$HOME/'* | '${HOME}/'*) file=$HOME/${file#*/} ;;
      '$PWD/'* | '${PWD}/'*) [ -n "$BASE" ] || set_base_dir; file=$BASE/${file#*/} ;;
      '$TMPDIR/'* | '${TMPDIR}/'*) [ -n "$TMPDIR" ] && file=${TMPDIR%/}/${file#*/} ;;
    esac

    case $file in
      '' | - | *'$'* | *'`'* | *[*?]*) continue ;;
      /*) check_message_file "$file" ;;
      *)
        [ -n "$BASE" ] || set_base_dir
        check_message_file "$BASE/$file"

        if [ -n "$option" ]; then
          check_git_dir_file "$before" "$file"
        fi
        ;;
    esac
  done

  shopt -s nocasematch
}

if writes_message "$COMMAND"; then
  if has_attribution "$LINE_START" <<<"$COMMAND"; then
    deny "BLOCKED: Your command contains AI agent attribution. $RULE Remove the attribution and try again. If only a search in this command mentions it, run the search on its own."
  fi

  check_message_files
fi

if sets_agent_identity "$COMMAND"; then
  deny "BLOCKED: Your command makes the AI agent a commit author or committer. $RULE Commit with the identity that git is already configured with instead."
fi

exit 0
