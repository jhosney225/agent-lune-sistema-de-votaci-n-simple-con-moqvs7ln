
```javascript
import Anthropic from "@anthropic-ai/sdk";
import * as readline from "readline";

const client = new Anthropic();

interface Vote {
  voter: string;
  option: string;
  timestamp: Date;
}

interface Poll {
  id: string;
  question: string;
  options: string[];
  votes: Vote[];
  createdAt: Date;
}

// In-memory storage
const polls: Map<string, Poll> = new Map();
let currentPollId: string | null = null;

// Multi-turn conversation history for Claude
const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function generatePollId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function createPoll(question: string, options: string[]): string {
  const pollId = generatePollId();
  const poll: Poll = {
    id: pollId,
    question,
    options,
    votes: [],
    createdAt: new Date(),
  };
  polls.set(pollId, poll);
  return pollId;
}

function addVote(pollId: string, voter: string, option: string): boolean {
  const poll = polls.get(pollId);
  if (!poll) return false;
  if (!poll.options.includes(option)) return false;

  const vote: Vote = {
    voter,
    option,
    timestamp: new Date(),
  };
  poll.votes.push(vote);
  return true;
}

function getResults(pollId: string): string {
  const poll = polls.get(pollId);
  if (!poll) return "Poll not found";

  const results: Record<string, number> = {};
  poll.options.forEach((option) => {
    results[option] = 0;
  });

  poll.votes.forEach((vote) => {
    results[vote.option]++;
  });

  let resultsText = `\n📊 Results for: "${poll.question}"\n`;
  resultsText += `Total votes: ${poll.votes.length}\n`;
  resultsText += "─".repeat(40) + "\n";

  poll.options.forEach((option) => {
    const count = results[option];
    const percentage = poll.votes.length > 0 ? ((count / poll.votes.length) * 100).toFixed(1) : "0.0";
    const barLength = Math.round(count / 2);
    const bar = "█".repeat(barLength);
    resultsText += `${option}: ${count} votes (${percentage}%) ${bar}\n`;
  });

  return resultsText;
}

async function chat(userMessage: string): Promise<string> {
  conversationHistory.push({
    role: "user",
    content: userMessage,
  });

  const systemPrompt = `You are a voting system assistant. You help users create polls, cast votes, and view results.

Current polls available:
${Array.from(polls.entries())
  .map(([id, poll]) => {
    return `- Poll ID: ${id}\n  Question: ${poll.question}\n  Options: ${poll.options.join(", ")}\n  Votes: ${poll.votes.length}`;
  })
  .join("\n") || "No polls available"}

Current poll in focus: ${currentPollId ? `${currentPollId}` : "None"}

You can help with:
1. Creating new polls (ask for question and options)
2. Voting on existing polls (add a vote with voter name and option)
3. Viewing poll results
4. Listing available polls

When the user wants to create a poll, extract the question and options.
When the user wants to vote, extract the voter name and selected option.
Provide helpful responses and confirmation of actions taken.

Respond naturally and helpfully. If the user is creating a poll, confirm the details.
If they're voting, confirm their vote was recorded.`;

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    system: systemPrompt,
    messages: conversationHistory,
  });

  const assistantMessage = response.content[0].type === "text" ? response.content[0].text : "";

  conversationHistory.push({
    role: "assistant",
    content: assistantMessage,
  });

  // Parse the assistant's response for actions
  const lowerMessage = userMessage.toLowerCase();

  // Create poll
  if (
    lowerMessage.includes("create") ||
    lowerMessage.includes("new poll") ||
    lowerMessage.includes("start poll")
  ) {
    // Simple extraction - in real system would be more robust
    const questionMatch = userMessage.match(/question[:\s]*"?([^"\n]+)"?/i);
    const optionsMatch = userMessage.match(
      /options?[:\s]*([^\n]+(?:\n[^\n]+)*)/i
    );

    if (questionMatch && optionsMatch) {
      const question = questionMatch[1].trim();
      const options = optionsMatch[1]
        .split(/[,;]/)
        .map((o) => o.trim())
        .filter((o) => o);

      if (options.length >= 2) {
        const pollId = createPoll(question, options);
        currentPollId = pollId;
        return `✅ Poll created successfully!\nPoll ID: ${pollId}\nQuestion: ${question}\nOptions: ${options.join(", ")}\n\n${assistantMessage}`;
      }
    }
  }

  // Add vote
  if (
    (lowerMessage.includes("vote") ||
      l