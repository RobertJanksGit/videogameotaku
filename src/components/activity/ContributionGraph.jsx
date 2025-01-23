import { useState, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

const ContributionGraph = () => {
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const [yearData, setYearData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [totalWeeks, setTotalWeeks] = useState(52);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Check for year change every minute
  useEffect(() => {
    const checkYear = () => {
      const newYear = new Date().getFullYear();
      if (newYear !== currentYear) {
        setCurrentYear(newYear);
      }
    };

    const interval = setInterval(checkYear, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [currentYear]);

  // Calculate weeks per month for proper spacing
  const getMonthWeeks = () => {
    const startDate = new Date(currentYear, 0, 1);
    startDate.setHours(0, 0, 0, 0);

    const monthWeeks = months.map((_, index) => {
      const date = new Date(startDate);
      date.setMonth(index);
      const daysInMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
      ).getDate();
      return Math.ceil(daysInMonth / 7);
    });

    return monthWeeks;
  };

  useEffect(() => {
    const fetchContributions = async () => {
      if (!user) return;

      try {
        setIsLoading(true);

        const postsQuery = query(
          collection(db, "posts"),
          where("authorId", "==", user.uid)
        );
        const commentsQuery = query(
          collection(db, "comments"),
          where("authorId", "==", user.uid)
        );

        const [postsSnapshot, commentsSnapshot] = await Promise.all([
          getDocs(postsQuery),
          getDocs(commentsQuery),
        ]);

        // Start from January 1st of the current year
        const startDate = new Date(currentYear, 0, 1);
        startDate.setHours(0, 0, 0, 0);

        // Calculate the end date (December 31st)
        const endDate = new Date(currentYear, 11, 31);

        // Adjust start date to previous Sunday
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);

        // Calculate total weeks needed
        const totalDays =
          Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        const weeksNeeded = Math.ceil(totalDays / 7);
        setTotalWeeks(weeksNeeded);

        // Create empty data array for all weeks
        const data = [];
        const currentDate = new Date(startDate);

        // Fill in dates week by week
        while (data.length < weeksNeeded) {
          const week = [];
          for (let day = 0; day < 7; day++) {
            week.push({
              date: new Date(currentDate),
              count: 0,
            });
            currentDate.setDate(currentDate.getDate() + 1);
          }
          data.push(week);
        }

        // Count contributions
        const countContribution = (timestamp) => {
          if (!timestamp) return;

          const date = timestamp.toDate();
          // Convert both dates to UTC midnight for comparison
          const contributionDate = new Date(
            Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
          );

          for (let week = 0; week < data.length; week++) {
            for (let day = 0; day < 7; day++) {
              const gridDate = new Date(
                Date.UTC(
                  data[week][day].date.getFullYear(),
                  data[week][day].date.getMonth(),
                  data[week][day].date.getDate()
                )
              );

              if (contributionDate.getTime() === gridDate.getTime()) {
                data[week][day].count++;
                return;
              }
            }
          }
        };

        // Process posts and comments
        postsSnapshot.docs.forEach((doc) =>
          countContribution(doc.data().createdAt)
        );
        commentsSnapshot.docs.forEach((doc) =>
          countContribution(doc.data().createdAt)
        );

        setYearData(data);
      } catch (error) {
        console.error("Error fetching contributions:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContributions();
  }, [user, currentYear]);

  const getContributionColor = (count, date) => {
    // Check if date is outside current year
    if (date.getFullYear() !== currentYear) {
      return darkMode ? "bg-[#161B22] opacity-50" : "bg-[#ebedf0] opacity-50";
    }

    if (count === 0) return darkMode ? "bg-[#161B22]" : "bg-[#ebedf0]";
    if (count <= 3) return darkMode ? "bg-[#0E4429]" : "bg-[#9be9a8]";
    if (count <= 6) return darkMode ? "bg-[#006D32]" : "bg-[#40c463]";
    if (count <= 9) return darkMode ? "bg-[#26A641]" : "bg-[#30a14e]";
    return darkMode ? "bg-[#39D353]" : "bg-[#216e39]";
  };

  const formatDate = (date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-2">
          <h3
            className={`text-base font-semibold ${
              darkMode ? "text-[#ADBAC7]" : "text-gray-900"
            }`}
          >
            Loading contributions...
          </h3>
        </div>
      </div>
    );
  }

  const totalContributions = yearData.reduce(
    (total, week) => total + week.reduce((sum, day) => sum + day.count, 0),
    0
  );

  const monthWeeks = getMonthWeeks();

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`text-base font-semibold ${
            darkMode ? "text-[#ADBAC7]" : "text-gray-900"
          }`}
        >
          {totalContributions} contributions in the last year
        </h3>
      </div>

      <div className="relative">
        <div className="flex text-xs text-[#7D8590] mb-2">
          {months.map((month, i) => (
            <div
              key={month}
              style={{
                width: `${(monthWeeks[i] / totalWeeks) * 100}%`,
                marginLeft: i === 0 ? "34px" : "0",
                paddingLeft: i === 0 ? "0" : "4px",
              }}
            >
              {month}
            </div>
          ))}
        </div>

        <div className="flex gap-[3px] flex-1 mt-4">
          {yearData.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px] flex-1">
              {week.map((day, dayIndex) => (
                <div
                  key={`${weekIndex}-${dayIndex}`}
                  className={`w-[10px] h-[10px] rounded-sm ${getContributionColor(
                    day.count,
                    day.date
                  )}`}
                  title={`${day.count} contributions on ${formatDate(
                    day.date
                  )}`}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center mt-4 text-xs text-[#7D8590] space-x-2">
          <span>Less</span>
          <div
            className={`w-[10px] h-[10px] rounded-sm ${
              darkMode ? "bg-[#161B22]" : "bg-[#ebedf0]"
            }`}
          />
          <div
            className={`w-[10px] h-[10px] rounded-sm ${
              darkMode ? "bg-[#0E4429]" : "bg-[#9be9a8]"
            }`}
          />
          <div
            className={`w-[10px] h-[10px] rounded-sm ${
              darkMode ? "bg-[#006D32]" : "bg-[#40c463]"
            }`}
          />
          <div
            className={`w-[10px] h-[10px] rounded-sm ${
              darkMode ? "bg-[#26A641]" : "bg-[#30a14e]"
            }`}
          />
          <div
            className={`w-[10px] h-[10px] rounded-sm ${
              darkMode ? "bg-[#39D353]" : "bg-[#216e39]"
            }`}
          />
          <span>More</span>
        </div>

        <p
          className={`mt-4 text-xs ${
            darkMode ? "text-[#7D8590]" : "text-gray-500"
          }`}
        >
          Contributions are counted when you create a new post or comment on an
          existing post. Each action counts as one contribution.
        </p>
      </div>
    </div>
  );
};

export default ContributionGraph;
