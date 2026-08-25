// Shared name pools used across mock data generators.

export const TEAM_NAMES: Record<string, string[]> = {
  'premier-league': [
    'Arsenal', 'Manchester City', 'Liverpool', 'Chelsea', 'Tottenham Hotspur',
    'Manchester United', 'Newcastle United', 'Aston Villa', 'Brighton', 'West Ham United',
  ],
  championship: [
    'Leeds United', 'Leicester City', 'Southampton', 'Ipswich Town', 'West Bromwich Albion',
    'Norwich City', 'Sunderland', 'Coventry City',
  ],
  'la-liga': [
    'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Real Sociedad', 'Real Betis',
    'Villarreal', 'Athletic Bilbao', 'Sevilla', 'Valencia', 'Girona',
  ],
  'segunda-division': ['Racing Santander', 'Eibar', 'Almeria', 'Levante', 'Mirandes', 'Huesca'],
  'serie-a': [
    'Inter Milan', 'AC Milan', 'Juventus', 'Napoli', 'Atalanta',
    'AS Roma', 'Lazio', 'Fiorentina', 'Bologna', 'Torino',
  ],
  bundesliga: [
    'Bayern Munich', 'Bayer Leverkusen', 'Borussia Dortmund', 'RB Leipzig', 'Union Berlin',
    'Eintracht Frankfurt', 'Freiburg', 'Wolfsburg', 'Stuttgart',
  ],
  'ligue-1': [
    'Paris Saint-Germain', 'Monaco', 'Marseille', 'Lille', 'Lyon',
    'Rennes', 'Nice', 'Lens',
  ],
  eredivisie: ['Ajax', 'PSV Eindhoven', 'Feyenoord', 'AZ Alkmaar', 'FC Twente', 'FC Utrecht'],
  'primeira-liga': ['Benfica', 'Porto', 'Sporting CP', 'Braga', 'Vitoria SC'],
  brasileirao: [
    'Flamengo', 'Palmeiras', 'Sao Paulo', 'Corinthians', 'Atletico Mineiro',
    'Gremio', 'Internacional', 'Botafogo',
  ],
  'mls': ['LAFC', 'Inter Miami', 'Seattle Sounders', 'Columbus Crew', 'NYCFC'],
  'liga-mx': ['Club America', 'Chivas Guadalajara', 'Cruz Azul', 'Monterrey', 'Tigres UANL'],
}

export const FIRST_NAMES = [
  'Amara', 'Lucas', 'Priya', 'Noah', 'Elena', 'Marcus', 'Sofia', 'Daniel', 'Ines', 'Omar',
  'Chidi', 'Freya', 'Kenji', 'Talia', 'Victor', 'Nadia',
]

export const LAST_NAMES = [
  'Okafor', 'Silva', 'Kowalski', 'Bennett', 'Rossi', 'Haddad', 'Nakamura', 'Fischer',
  'Moreau', 'Alves', 'Petrov', 'Larsen',
]

export const EVIDENCE_SOURCES = [
  'Team news feed', 'Market movement scan', 'Lineup confirmation', 'Weather update',
  'Injury report', 'Referee assignment', 'Travel disruption note', 'Press conference signal',
  'Historical H2H refresh', 'Standings recompute',
]

export const CONFLICT_FIELDS = [
  'Kickoff time', 'Venue', 'Starting lineup', 'Referee', 'Home/away designation',
  'Player injury status', 'Match status', 'Attendance capacity',
]
