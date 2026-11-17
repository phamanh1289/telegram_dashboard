// Ordered chapters: preserve catalog and AI prompt order across languages.
import shell from "./shell.json";
import telegramNavigation from "./telegram-navigation.json";
import telegramGroup from "./telegram-group.json";
import telegramBriefing from "./telegram-briefing.json";
import telegramMessages from "./telegram-messages.json";
import telegramComposer from "./telegram-composer.json";
import telegramAgent from "./telegram-agent.json";
import settings from "./settings.json";
import youtrackNavigation from "./youtrack-navigation.json";
import youtrackHome from "./youtrack-home.json";
import youtrackTickets from "./youtrack-tickets.json";
import youtrackDetails from "./youtrack-details.json";
import youtrackAi from "./youtrack-ai.json";
import youtrackDashboard from "./youtrack-dashboard.json";
import telegramWork from "./telegram-work.json";

const features = [
  ...shell,
  ...telegramNavigation,
  ...telegramGroup,
  ...telegramBriefing,
  ...telegramMessages,
  ...telegramComposer,
  ...telegramAgent,
  ...settings,
  ...youtrackNavigation,
  ...youtrackHome,
  ...youtrackTickets,
  ...youtrackDetails,
  ...youtrackAi,
  ...youtrackDashboard,
  ...telegramWork,
];

export default features;
