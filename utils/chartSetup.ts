// Chart.js's pieces, registered once, by whatever draws a chart: import this
// file for its side effect next to `vue-chartjs`.
//
// It was a global plugin (plugins/chartjs.client.ts), which put chart.js --
// 172 KB, the largest single library in the bundle -- into the entry chunk
// every page loads, the sign-in screen and the Inbox included, though only
// the reports and the dashboard's report blocks draw a chart. Imported from
// those, it arrives with them.
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend)
