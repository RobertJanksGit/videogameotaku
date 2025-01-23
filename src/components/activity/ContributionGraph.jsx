import PropTypes from "prop-types";
import { useState, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";

const ContributionGraph = ({ contributions }) => {
  const { darkMode } = useTheme();
  const [yearData, setYearData] = useState([]);
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

  useEffect(() => {
    // Create a year's worth of data
    const today = new Date();
    const startDate = new Date(today);
    startDate.setFullYear(today.getFullYear() - 1);

    const data = [];
    let currentDate = new Date(startDate);

    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const count = contributions[dateStr] || 0;

      data.push({
        date: new Date(currentDate),
        count: count,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    setYearData(data);
  }, [contributions]);

  const getContributionColor = (count) => {
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

  const getWeeks = () => {
    const weeks = [];
    let currentWeek = [];

    yearData.forEach((day, index) => {
      currentWeek.push(day);

      if (currentWeek.length === 7 || index === yearData.length - 1) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    return weeks;
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`text-base font-semibold ${
            darkMode ? "text-[#ADBAC7]" : "text-gray-900"
          }`}
        >
          {yearData.reduce((sum, day) => sum + day.count, 0)} contributions in
          the last year
        </h3>
      </div>

      <div className="relative">
        <div className="flex text-xs text-[#7D8590] mb-2">
          {months.map((month, i) => (
            <div
              key={month}
              className="flex-1"
              style={{ marginLeft: i === 0 ? "34px" : "0" }}
            >
              {month}
            </div>
          ))}
        </div>

        <div className="flex">
          <div className="flex flex-col text-xs text-[#7D8590] mr-2 mt-4 space-y-3">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
          </div>

          <div className="grid grid-flow-col gap-[3px]">
            {getWeeks().map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-rows-7 gap-[3px]">
                {week.map((day, dayIndex) => (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    className={`w-[10px] h-[10px] rounded-sm ${getContributionColor(
                      day.count
                    )} cursor-pointer`}
                    title={`${day.count} contributions on ${formatDate(
                      day.date
                    )}`}
                  />
                ))}
              </div>
            ))}
          </div>
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
      </div>
    </div>
  );
};

ContributionGraph.propTypes = {
  contributions: PropTypes.object.isRequired,
};

export default ContributionGraph;
