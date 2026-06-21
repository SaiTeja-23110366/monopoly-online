import re

with open('client/src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Extract the Sabotage JSX block
sabotage_match = re.search(r'\{\s*gameState\.awaitingSabotage && isMyTurn && \(\s*<div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-\[60vh\] md:h-auto md:w-80 bg-\[#161622\]/95 border-t md:border-t-0 md:border-r border-red-500 z-\[60\] flex flex-col shadow-\[0_-20px_50px_rgba\(220,38,38,0\.2\)\] md:shadow-\[20px_0_50px_rgba\(220,38,38,0\.2\)\] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">\s*(.*?)\s*</div>\s*\)\s*\}', content, flags=re.DOTALL)

# 2. Extract the Protection JSX block
protection_match = re.search(r'\{\s*gameState\.awaitingProtection && isMyTurn && \(\s*<div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-\[60vh\] md:h-auto md:w-80 bg-\[#161622\]/95 border-t md:border-t-0 md:border-r border-cyan-500 z-\[60\] flex flex-col shadow-\[0_-20px_50px_rgba\(6,182,212,0\.2\)\] md:shadow-\[20px_0_50px_rgba\(6,182,212,0\.2\)\] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">\s*(.*?)\s*</div>\s*\)\s*\}', content, flags=re.DOTALL)

# 3. Extract the Debt Resolution JSX block
debt_match = re.search(r'\{\s*isAwaitingDebtResolution && \(\s*<div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-\[70vh\] md:h-auto md:w-96 bg-\[#161622\]/95 border-t md:border-t-0 md:border-r border-red-600 z-\[60\] flex flex-col shadow-\[0_-20px_50px_rgba\(220,38,38,0\.3\)\] md:shadow-\[20px_0_50px_rgba\(220,38,38,0\.3\)\] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">\s*(.*?)\s*</div>\s*\)\s*\}', content, flags=re.DOTALL)

if not sabotage_match or not protection_match or not debt_match:
    print("FAILED TO MATCH ONE OR MORE BLOCKS")
    print("Sabotage:", bool(sabotage_match))
    print("Protection:", bool(protection_match))
    print("Debt:", bool(debt_match))
    exit(1)

sabotage_inner = sabotage_match.group(1)
protection_inner = protection_match.group(1)
debt_inner = debt_match.group(1)

# Assemble new if statements for centerContent
new_statements = f"""  if (gameState.awaitingSabotage && isMyTurn) {{
    centerContent = (
      <div className="bg-[#161622] border-2 border-red-500 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-md shadow-[0_0_50px_rgba(220,38,38,0.5)] flex flex-col pointer-events-auto max-h-[80vh] animate-in fade-in zoom-in duration-300">
        {sabotage_inner.strip()}
      </div>
    );
  }} else if (gameState.awaitingProtection && isMyTurn) {{
    centerContent = (
      <div className="bg-[#161622] border-2 border-cyan-500 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-md shadow-[0_0_50px_rgba(6,182,212,0.5)] flex flex-col pointer-events-auto max-h-[80vh] animate-in fade-in zoom-in duration-300">
        {protection_inner.strip()}
      </div>
    );
  }} else if (isAwaitingDebtResolution) {{
    centerContent = (
      <div className="bg-[#161622] border-2 border-red-600 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-md shadow-[0_0_50px_rgba(220,38,38,0.5)] flex flex-col pointer-events-auto max-h-[80vh] animate-in fade-in zoom-in duration-300">
        {debt_inner.strip()}
      </div>
    );
  }} else if (viewingSquareIndex !== null && !isAwaitingBuy && !isAwaitingFlight && !isJailDecision) {{
"""

# Replace the condition logic in App.tsx
content = content.replace("  if (viewingSquareIndex !== null && !isAwaitingBuy && !isAwaitingFlight && !isJailDecision) {", new_statements)

# Remove the old JSX blocks completely
content = content[:sabotage_match.start()] + content[sabotage_match.end():]

# Re-search for protection and debt since offsets changed
protection_match = re.search(r'\{\s*gameState\.awaitingProtection && isMyTurn && \(\s*<div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-\[60vh\] md:h-auto md:w-80 bg-\[#161622\]/95 border-t md:border-t-0 md:border-r border-cyan-500 z-\[60\] flex flex-col shadow-\[0_-20px_50px_rgba\(6,182,212,0\.2\)\] md:shadow-\[20px_0_50px_rgba\(6,182,212,0\.2\)\] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">\s*(.*?)\s*</div>\s*\)\s*\}', content, flags=re.DOTALL)
if protection_match:
    content = content[:protection_match.start()] + content[protection_match.end():]

debt_match = re.search(r'\{\s*isAwaitingDebtResolution && \(\s*<div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-\[70vh\] md:h-auto md:w-96 bg-\[#161622\]/95 border-t md:border-t-0 md:border-r border-red-600 z-\[60\] flex flex-col shadow-\[0_-20px_50px_rgba\(220,38,38,0\.3\)\] md:shadow-\[20px_0_50px_rgba\(220,38,38,0\.3\)\] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">\s*(.*?)\s*</div>\s*\)\s*\}', content, flags=re.DOTALL)
if debt_match:
    content = content[:debt_match.start()] + content[debt_match.end():]

with open('client/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
